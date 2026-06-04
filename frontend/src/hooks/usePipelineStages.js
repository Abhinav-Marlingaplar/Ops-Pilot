/**
 * hooks/usePipelineStages.js
 *
 * Derives pipeline stage state from the `logLines` array produced by
 * useBuildDetail. Works in three modes:
 *
 *   1. Live build — stages animate in real-time as log lines arrive via
 *      Socket.IO. Every new line is processed immediately.
 *
 *   2. Replay (opened mid-build or after) — the server sends all stored lines
 *      as a `build:replay` burst. useBuildDetail seeds logLines with these,
 *      so this hook sees them as a batch and runs the animated replay path
 *      to show stages lighting up sequentially.
 *
 *   3. Completed build, no markers — buildStatus is 'success'/'failed' but
 *      the stored logs don't contain stage marker strings. Snaps to final
 *      state immediately.
 *
 * ── Fix: removed isReplaying guard ───────────────────────────────────────────
 * The original code set `isReplaying.current = true` during the animated
 * replay and skipped the live processing effect while that flag was set.
 * This meant any `build:log` events that arrived during the replay animation
 * (300ms × 6 stages = ~1.8s window) were permanently dropped — the stage
 * tracker would freeze mid-animation then never advance.
 *
 * The fix: live lines always get processed. Replay and live are additive.
 * `processedCount` tracks how many lines have been consumed, so both paths
 * only act on genuinely new lines.
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
 * Apply a single log line to stageMap. Pure function — returns new map.
 * @returns {{ next: object, newActive: string }}
 */
function applyLine(stageMap, line, activeStage) {
  const now = Date.now()
  let next      = { ...stageMap }
  let newActive = activeStage

  for (const { pattern, stage } of STAGE_TRIGGERS) {
    if (!pattern.test(line)) continue

    if (stage === 'failed') {
      // Mark any running stage as failed
      Object.keys(next).forEach(id => {
        if (next[id].status === 'running') {
          next[id] = { ...next[id], status: 'failed', duration: now - (next[id].startedAt ?? now) }
        }
      })
      newActive = 'failed'
    } else {
      // Complete any currently-running stage
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
      newActive = stage
    }
    break
  }

  return { next, newActive }
}

export function usePipelineStages(logLines, buildStatus) {
  const [stageMap,    setStageMap] = useState(initStageMap)
  const [activeStage, setActive]   = useState('queued')

  // How many lines from logLines have already been processed into stageMap
  const processedCount = useRef(0)

  // Pending animated-replay timers
  const replayTimers = useRef([])

  const cancelReplay = useCallback(() => {
    replayTimers.current.forEach(clearTimeout)
    replayTimers.current = []
  }, [])

  // ── Reset when the viewed build changes (BuildDetail remounts) ─────────────
  useEffect(() => {
    cancelReplay()
    processedCount.current = 0
    setStageMap(initStageMap())
    setActive('queued')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Process new log lines — both live AND replayed ─────────────────────────
  // This effect runs every time logLines changes (i.e. every new line from
  // Socket.IO or every replay burst). It only processes lines it hasn't seen
  // before, tracked via processedCount.
  //
  // For small batches (≤3 new lines) — typical during live streaming — it
  // applies the changes synchronously, giving instant stage transitions.
  //
  // For large batches (replay bursts, >3 lines) — it plays an animation:
  // each stage marker fires 300ms after the previous one.
  useEffect(() => {
    const newLines = logLines.slice(processedCount.current)
    if (newLines.length === 0) return

    // Find which of the new lines are stage markers
    const markerLines = newLines.filter(({ line }) =>
      STAGE_TRIGGERS.some(({ pattern }) => pattern.test(line))
    )

    // Always advance the processed pointer
    processedCount.current = logLines.length

    if (markerLines.length === 0) return

    const isLargeReplay = newLines.length > 3

    if (!isLargeReplay) {
      // ── Synchronous path: live events ─────────────────────────────────────
      // Apply all markers immediately so stage transitions feel instant
      setStageMap(prev => {
        let current   = { ...prev }
        let curActive = activeStage

        markerLines.forEach(({ line }) => {
          const { next, newActive } = applyLine(current, line, curActive)
          current   = next
          curActive = newActive
        })

        setActive(curActive)
        return current
      })
    } else {
      // ── Animated path: replay burst ────────────────────────────────────────
      // Play stage markers one at a time with a 300ms gap so the user sees
      // the pipeline light up sequentially rather than jumping to final state.
      cancelReplay()

      // Capture current map for the closure chain
      let currentMap    = null   // will be read from state in first timer
      let currentActive = activeStage
      let delay         = 0

      markerLines.forEach(({ line }, idx) => {
        delay += 300
        const t = setTimeout(() => {
          setStageMap(prev => {
            const base = currentMap ?? prev
            const { next, newActive } = applyLine(base, line, currentActive)
            currentMap    = next
            currentActive = newActive
            setActive(newActive)
            return next
          })
        }, delay)
        replayTimers.current.push(t)
      })
    }
  // activeStage intentionally omitted — we manage it inside setStageMap callbacks
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logLines])

  // ── Fallback: build finished but no stage markers in logs ─────────────────
  useEffect(() => {
    if (buildStatus !== 'success' && buildStatus !== 'failed') return
    if (logLines.length === 0) return

    const hasAnyMarker = logLines.some(({ line }) =>
      STAGE_TRIGGERS.some(({ pattern }) => pattern.test(line))
    )

    // If we have markers, the logLines effect already handled it
    if (hasAnyMarker) return

    // No markers at all — snap to final state
    cancelReplay()
    if (buildStatus === 'success') {
      const allGreen = {}
      STAGES.forEach(s => { allGreen[s.id] = { status: 'success', startedAt: null, duration: null } })
      setStageMap(allGreen)
      setActive('complete')
    } else {
      // failed with no markers — mark everything waiting except queued
      setStageMap(initStageMap())
      setActive('queued')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildStatus])

  // Cleanup timers on unmount
  useEffect(() => () => cancelReplay(), [cancelReplay])

  const stages = STAGES.map(s => ({
    ...s,
    ...(stageMap[s.id] ?? { status: 'waiting' }),
  }))

  return { stages, activeStage }
}