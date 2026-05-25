/**
 * hooks/usePipelineStages.js
 *
 * Derives pipeline stage state from log lines streaming via Socket.IO.
 *
 * Three modes:
 *   1. Live build     — stages animate in real-time as log lines arrive
 *   2. Completed build opened later — replays stored logs with 80ms delays
 *      so the animation is visible, then snaps to final state
 *   3. Fallback       — if no completion marker found in stored logs but
 *      buildStatus is 'success', mark all green after replay finishes
 */

import { useEffect, useRef, useState } from 'react'

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

/** Apply a single log line to a stageMap, returning the updated map + new activeStage */
function applyLine(stageMap, line, activeStage) {
  const now = Date.now()
  let next = { ...stageMap }
  let newActive = activeStage

  for (const { pattern, stage } of STAGE_TRIGGERS) {
    if (pattern.test(line)) {
      if (stage === 'failed') {
        Object.keys(next).forEach(id => {
          if (next[id].status === 'running') {
            next[id] = { ...next[id], status: 'failed', duration: now - (next[id].startedAt ?? now) }
          }
        })
        newActive = 'failed'
      } else {
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
        newActive = stage
      }
      break
    }
  }

  return { next, newActive }
}

export function usePipelineStages(logLines, buildStatus) {
  const [stageMap,    setStageMap] = useState(() => initStageMap())
  const [activeStage, setActive]   = useState('queued')

  const processedCount = useRef(0)
  const isReplaying    = useRef(false)
  const replayTimers   = useRef([])

  // Clear all pending replay timers
  function cancelReplay() {
    replayTimers.current.forEach(t => clearTimeout(t))
    replayTimers.current = []
    isReplaying.current = false
  }

  // Reset on mount (parent re-mounts when build changes)
  useEffect(() => {
    cancelReplay()
    processedCount.current = 0
    setStageMap(initStageMap())
    setActive('queued')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Live streaming: process only newly arrived lines ────────────────────────
  useEffect(() => {
    // Skip if we're doing an animated replay
    if (isReplaying.current) return

    const newLines = logLines.slice(processedCount.current)
    if (newLines.length === 0) return
    processedCount.current = logLines.length

    setStageMap(prev => {
      let current = { ...prev }
      let currentActive = activeStage

      newLines.forEach(({ line }) => {
        const { next, newActive } = applyLine(current, line, currentActive)
        current = next
        currentActive = newActive
      })

      // Update activeStage outside of setStageMap
      setActive(currentActive)
      return current
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logLines])

  // ── Sync final build status ─────────────────────────────────────────────────
  useEffect(() => {
    if (buildStatus === 'queued') {
      cancelReplay()
      processedCount.current = 0
      setStageMap(initStageMap())
      setActive('queued')
      return
    }

    // Build is done — check if we have stored logs to replay
    if ((buildStatus === 'success' || buildStatus === 'failed') && logLines.length > 0) {
      // Find which stage markers exist in stored logs
      const markerLines = logLines.filter(({ line }) =>
        STAGE_TRIGGERS.some(({ pattern }) => pattern.test(line))
      )

      if (markerLines.length === 0) {
        // No markers in stored logs — force final state immediately
        if (buildStatus === 'success') {
          setStageMap(() => {
            const map = {}
            STAGES.forEach(s => { map[s.id] = { status: 'success', startedAt: null, duration: null } })
            return map
          })
          setActive('complete')
        }
        return
      }

      // Check if completion marker is in stored logs
      const hasCompletion = logLines.some(({ line }) =>
        /Pipeline completed.*SUCCESS/i.test(line) || /PIPELINE FAILED/i.test(line)
      )

      // Only replay if we haven't already processed these lines live
      if (processedCount.current >= logLines.length) return

      // Animated replay — show stages lighting up one by one
      cancelReplay()
      isReplaying.current = true
      processedCount.current = logLines.length

      // Reset to initial state first
      setStageMap(initStageMap())
      setActive('queued')

      let currentMap = initStageMap()
      let currentActive = 'queued'
      let delay = 0

      markerLines.forEach(({ line }) => {
        delay += 300 // 300ms between each stage transition

        const t = setTimeout(() => {
          const { next, newActive } = applyLine(currentMap, line, currentActive)
          currentMap = next
          currentActive = newActive
          setStageMap({ ...next })
          setActive(newActive)
        }, delay)

        replayTimers.current.push(t)
      })

      // After all markers, if no completion marker found but build succeeded,
      // force all-green
      if (!hasCompletion && buildStatus === 'success') {
        const finalTimer = setTimeout(() => {
          setStageMap(() => {
            const map = {}
            STAGES.forEach(s => { map[s.id] = { status: 'success', startedAt: null, duration: null } })
            return map
          })
          setActive('complete')
          isReplaying.current = false
        }, delay + 300)
        replayTimers.current.push(finalTimer)
      } else {
        const doneTimer = setTimeout(() => {
          isReplaying.current = false
        }, delay + 100)
        replayTimers.current.push(doneTimer)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildStatus, logLines.length])

  // Cleanup timers on unmount
  useEffect(() => () => cancelReplay(), [])

  const stages = STAGES.map(s => ({
    ...s,
    ...(stageMap[s.id] ?? { status: 'waiting' }),
  }))

  return { stages, activeStage }
}