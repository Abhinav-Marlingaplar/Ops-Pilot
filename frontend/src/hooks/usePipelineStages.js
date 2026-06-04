/**
 * hooks/usePipelineStages.js
 *
 * Derives pipeline stage state from logLines produced by useBuildDetail.
 *
 * ── Two execution paths ───────────────────────────────────────────────────────
 *
 * LIVE (build currently running):
 *   logLines grows one entry at a time via Socket.IO build:log events.
 *   Each new line is processed synchronously — instant stage transitions.
 *
 * REPLAY (build opened after completion, or mid-build catch-up):
 *   logLines arrives as a large batch (fetchDetail HTTP response or
 *   build:replay socket burst). We animate the stage markers sequentially
 *   with 300ms gaps so the user sees the pipeline light up, rather than
 *   jumping straight to the final state.
 *
 * ── The closure bug that was breaking replay ──────────────────────────────────
 * The previous implementation scheduled all replay timeouts upfront in a loop:
 *
 *   markerLines.forEach(({ line }) => {
 *     delay += 300
 *     setTimeout(() => {
 *       const { next, newActive } = applyLine(currentMap, line, currentActive)
 *       // ↑ currentMap and currentActive captured at loop time — STALE
 *     }, delay)
 *   })
 *
 * All six timeouts closed over the SAME `currentMap` and `currentActive`
 * references as they existed when the loop ran. Each timeout saw
 * currentActive = 'queued' because the previous timeout's assignment
 * (`currentActive = newActive`) only mutated the local variable after
 * the closure was already captured.
 *
 * Result: every stage was evaluated as if coming from 'queued', so only
 * the last marker's stage was correctly set — everything before it was
 * wrong or missing. The tracker appeared frozen at whichever stage happened
 * to "win" the race.
 *
 * ── Fix: chained recursive timeouts ──────────────────────────────────────────
 * Instead of scheduling all timeouts at once, each timeout schedules the
 * NEXT one when it completes. State is passed explicitly through the chain
 * rather than via closure mutation. No stale references possible.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

export const STAGES = [
  { id: 'queued',   label: 'Queued',   icon: '◎' },
  { id: 'clone',    label: 'Clone',    icon: '⎋' },
  { id: 'checkout', label: 'Checkout', icon: '⌥' },
  { id: 'install',  label: 'Install',  icon: '⬇' },
  { id: 'test',     label: 'Test',     icon: '⚗' },
  { id: 'docker',   label: 'Docker',   icon: '◈' },
  { id: 'complete', label: 'Complete', icon: '✓' },
]

const STAGE_TRIGGERS = [
  { pattern: /Step 1\/5.*Clone/i,            stage: 'clone'    },
  { pattern: /Step 2\/5/i,                   stage: 'checkout' },
  { pattern: /Step 3\/5.*install/i,          stage: 'install'  },
  { pattern: /Step 4\/5.*test/i,             stage: 'test'     },
  { pattern: /Step 5\/5.*[Dd]ocker/i,        stage: 'docker'   },
  { pattern: /Pipeline completed.*SUCCESS/i, stage: 'complete' },
  { pattern: /PIPELINE FAILED/i,             stage: 'failed'   },
]

function initStageMap() {
  const map = {}
  STAGES.forEach(s => {
    map[s.id] = {
      status:    s.id === 'queued' ? 'success' : 'waiting',
      startedAt: null,
      duration:  null,
    }
  })
  return map
}

/**
 * Pure function — applies one log line to a stageMap.
 * Returns a new map and the new activeStage. Never mutates input.
 */
function applyLine(stageMap, line, activeStage) {
  const now = Date.now()

  for (const { pattern, stage } of STAGE_TRIGGERS) {
    if (!pattern.test(line)) continue

    const next = { ...stageMap }

    if (stage === 'failed') {
      Object.keys(next).forEach(id => {
        if (next[id].status === 'running') {
          next[id] = { ...next[id], status: 'failed', duration: now - (next[id].startedAt ?? now) }
        }
      })
      return { next, newActive: 'failed' }
    }

    // Complete the previously running stage
    Object.keys(next).forEach(id => {
      if (next[id].status === 'running') {
        next[id] = { ...next[id], status: 'success', duration: now - (next[id].startedAt ?? now) }
      }
    })

    next[stage] = {
      ...next[stage],
      status:    stage === 'complete' ? 'success' : 'running',
      startedAt: now,
    }

    return { next, newActive: stage }
  }

  // Line didn't match any trigger — no change
  return { next: stageMap, newActive: activeStage }
}

export function usePipelineStages(logLines, buildStatus) {
  const [stageMap,    setStageMap] = useState(initStageMap)
  const [activeStage, setActive]   = useState('queued')

  // How many logLines have been consumed into stageMap
  const processedCount = useRef(0)
  // Pending replay timer IDs for cleanup
  const replayTimers   = useRef([])

  const cancelReplay = useCallback(() => {
    replayTimers.current.forEach(clearTimeout)
    replayTimers.current = []
  }, [])

  // Reset everything when the component mounts (new build selected)
  useEffect(() => {
    cancelReplay()
    processedCount.current = 0
    setStageMap(initStageMap())
    setActive('queued')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Main effect: process new log lines ─────────────────────────────────────
  useEffect(() => {
    const newLines = logLines.slice(processedCount.current)
    if (newLines.length === 0) return

    processedCount.current = logLines.length

    // Extract only lines that match a stage trigger
    const markerLines = newLines
      .map(l => l.line)
      .filter(line => STAGE_TRIGGERS.some(({ pattern }) => pattern.test(line)))

    if (markerLines.length === 0) return

    const isLargeReplay = newLines.length > 3

    if (!isLargeReplay) {
      // ── Live path: apply all markers synchronously ──────────────────────────
      // Small batches = live streaming = instant transitions
      setStageMap(prev => {
        let map    = prev
        let active = activeStage

        markerLines.forEach(line => {
          const { next, newActive } = applyLine(map, line, active)
          map    = next
          active = newActive
        })

        setActive(active)
        return map
      })

    } else {
      // ── Replay path: chain timeouts so each fires after the previous ─────────
      // CRITICAL: do NOT schedule all timeouts at once with increasing delays.
      // That pattern captures stale closure values. Instead, each timeout
      // explicitly receives the current map/active from the previous step
      // and schedules the next one itself.
      cancelReplay()

      // Snapshot current stageMap synchronously before any async work
      setStageMap(currentMap => {
        // Schedule the chain starting from the current state
        scheduleChain(markerLines, 0, currentMap, activeStage)
        // Return unchanged for now — chain will call setStageMap per step
        return currentMap
      })
    }
  // activeStage intentionally not in deps — read inside setStageMap callback
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logLines, cancelReplay])

  /**
   * Recursive chained timeout — processes one marker per tick.
   * Passes current state explicitly to avoid stale closures.
   *
   * @param {string[]} markers  Remaining marker lines to process
   * @param {number}   index    Current position in markers array
   * @param {object}   map      Current stageMap (passed explicitly, not closed over)
   * @param {string}   active   Current activeStage (passed explicitly)
   */
  function scheduleChain(markers, index, map, active) {
    if (index >= markers.length) return

    const t = setTimeout(() => {
      const line = markers[index]
      const { next, newActive } = applyLine(map, line, active)

      setStageMap(next)
      setActive(newActive)

      // Schedule the next step with the updated state
      scheduleChain(markers, index + 1, next, newActive)
    }, 300)

    replayTimers.current.push(t)
  }

  // ── Fallback: build done but no stage markers in logs ──────────────────────
  useEffect(() => {
    if (buildStatus !== 'success' && buildStatus !== 'failed') return
    if (logLines.length === 0) return

    const hasMarker = logLines.some(({ line }) =>
      STAGE_TRIGGERS.some(({ pattern }) => pattern.test(line))
    )
    if (hasMarker) return // markers present — main effect handles it

    // No markers at all — snap to terminal state immediately
    cancelReplay()
    if (buildStatus === 'success') {
      const allGreen = {}
      STAGES.forEach(s => {
        allGreen[s.id] = { status: 'success', startedAt: null, duration: null }
      })
      setStageMap(allGreen)
      setActive('complete')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildStatus])

  // Cleanup on unmount
  useEffect(() => () => cancelReplay(), [cancelReplay])

  const stages = STAGES.map(s => ({
    ...s,
    ...(stageMap[s.id] ?? { status: 'waiting' }),
  }))

  return { stages, activeStage }
}