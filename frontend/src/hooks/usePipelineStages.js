/**
 * hooks/usePipelineStages.js
 *
 * Derives the pipeline stage state purely from the log lines already
 * streaming via Socket.IO — no backend changes needed.
 *
 * The runner emits fixed marker strings at the start of each step:
 *   "── Step 1/5: Clone repository ──"
 *   "── Step 2/5: ..."
 *   "── Step 3/5: npm install ──"
 *   "── Step 4/5: npm test ──"
 *   "── Step 5/5: Docker build ──"
 *   "=== Pipeline completed: SUCCESS ==="
 *   "PIPELINE FAILED"
 *
 * We scan every incoming line against these patterns and update the stage
 * state accordingly. Each stage gets a startedAt timestamp so we can show
 * per-stage durations.
 */

import { useEffect, useRef, useState } from 'react'

export const STAGES = [
  { id: 'queued', label: 'Queued', icon: '◎' },
  { id: 'clone', label: 'Clone', icon: '⎋' },
  { id: 'checkout', label: 'Checkout', icon: '⌥' },
  { id: 'install', label: 'Install', icon: '⬇' },
  { id: 'test', label: 'Test', icon: '⚗' },
  { id: 'docker', label: 'Docker', icon: '◈' },
  { id: 'complete', label: 'Complete', icon: '✓' },
]

// Maps a log line pattern → the stage it activates
const STAGE_TRIGGERS = [
  { pattern: /Step 1\/5.*Clone/i, stage: 'clone' },
  { pattern: /Step 2\/5/i, stage: 'checkout' },
  { pattern: /Step 3\/5.*install/i, stage: 'install' },
  { pattern: /Step 4\/5.*test/i, stage: 'test' },
  { pattern: /Step 5\/5.*[Dd]ocker/i, stage: 'docker' },
  { pattern: /Pipeline completed.*SUCCESS/i, stage: 'complete' },
  { pattern: /PIPELINE FAILED/i, stage: 'failed' },
]

/**
 * @param {Array<{line: string, ts: number}>} logLines
 * @param {string} buildStatus  — from the build row ('queued'|'running'|'success'|'failed')
 * @returns {{
 *   stages: Array<{ id, label, icon, status: 'waiting'|'running'|'success'|'failed', startedAt, duration }>,
 *   activeStage: string,
 * }}
 */
export function usePipelineStages(logLines, buildStatus) {
  const [stageMap, setStageMap] = useState(() => initStageMap())
  const [activeStage, setActive] = useState('queued')
  const processedCount = useRef(0)

  // Re-derive from scratch whenever logLines array identity changes (new build selected)
  useEffect(() => {
    processedCount.current = 0
    setStageMap(initStageMap())
    setActive('queued')
  }, []) // only on mount — parent re-mounts when build changes

  // Process only newly arrived lines (avoid re-scanning the whole array every render)
  useEffect(() => {
    const newLines = logLines.slice(processedCount.current)
    if (newLines.length === 0) return
    processedCount.current = logLines.length

    setStageMap(prev => {
      const next = { ...prev }

      newLines.forEach(({ line, ts }) => {
        const now = ts || Date.now()

        for (const { pattern, stage } of STAGE_TRIGGERS) {
          if (pattern.test(line)) {
            if (stage === 'failed') {
              // Mark the currently running stage as failed
              Object.keys(next).forEach(id => {
                if (next[id].status === 'running') {
                  next[id] = {
                    ...next[id],
                    status: 'failed',
                    duration: now - (next[id].startedAt ?? now),
                  }
                }
              })
              setActive('failed')
            } else {
              // Complete the previously running stage
              Object.keys(next).forEach(id => {
                if (next[id].status === 'running') {
                  next[id] = {
                    ...next[id],
                    status: 'success',
                    duration: now - (next[id].startedAt ?? now),
                  }
                }
              })
              // Activate the new stage
              next[stage] = {
                ...next[stage],
                status: stage === 'complete' ? 'success' : 'running',
                startedAt: now,
              }
              setActive(stage)
            }
            break
          }
        }
      })

      return next
    })
  }, [logLines])

  // Sync final build status — only force completion for already-finished builds
  useEffect(() => {
    if (buildStatus === 'queued') {
      setStageMap(initStageMap())
      setActive('queued')
      return
    }

    // Only force final state if build is done AND we have no live log progress
    // (i.e. the build was already complete when panel was opened)
    if (buildStatus === 'success' && processedCount.current === 0) {
      setStageMap(() => {
        const map = {}
        STAGES.forEach(s => {
          map[s.id] = { status: 'success', startedAt: null, duration: null }
        })
        return map
      })
      setActive('complete')
      return
    }

    if (buildStatus === 'failed' && processedCount.current === 0) {
      setStageMap(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(id => {
          if (next[id].status === 'waiting') {
            next[id] = { ...next[id], status: 'failed' }
          }
        })
        return next
      })
      setActive('failed')
    }
  }, [buildStatus])

  const stages = STAGES.map(s => ({
    ...s,
    ...(stageMap[s.id] ?? { status: 'waiting' }),
  }))

  return { stages, activeStage }
}

function initStageMap() {
  const map = {}
  STAGES.forEach(s => {
    map[s.id] = {
      status: s.id === 'queued' ? 'success' : 'waiting',
      startedAt: null,
      duration: null,
    }
  })
  return map
}