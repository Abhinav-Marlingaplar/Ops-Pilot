/**
 * hooks/useBuildDetail.js
 *
 * Fetches a single build, joins its Socket.IO room, and maintains live state.
 *
 * ── Architecture ──────────────────────────────────────────────────────────────
 *
 * Three separate useEffects with clearly separated responsibilities:
 *
 *   Effect 1 — [buildId]
 *     Fetches the build row from the API on mount / build change.
 *     Seeds logLines from stored logs if socket replay hasn't arrived yet.
 *
 *   Effect 2 — [buildId]  (socket event listeners — registered ONCE)
 *     Subscribes to build:replay, build:log, build:update.
 *     Uses refs for all handler logic so handlers never go stale and this
 *     effect NEVER needs to re-run. Stale closure = dropped events.
 *
 *   Effect 3 — [buildId]  (room join/leave)
 *     Emits build:join when buildId is set, build:leave on cleanup.
 *     Separated from Effect 2 so listener registration and room membership
 *     are independently managed.
 *
 * ── Why refs for handlers ─────────────────────────────────────────────────────
 * If onLog closes over `logLines` directly, it captures the value at the time
 * the effect ran (empty array). Every subsequent call does:
 *   setLogLines([...[], newLine])   ← always resets to single-element array
 *
 * Using the functional updater form `setLogLines(prev => [...prev, line])`
 * avoids this — React always passes the current value as `prev`.
 * The ref pattern makes this explicit and prevents accidental closure captures.
 */

import { useEffect, useState, useCallback, useRef } from 'react'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

/**
 * @param {number | null}                       buildId
 * @param {import('socket.io-client').Socket}   socket
 */
export function useBuildDetail(buildId, socket) {
  const [build,    setBuild]    = useState(null)
  const [logLines, setLogLines] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // Has a build:replay event already seeded logLines?
  // If yes, don't overwrite with the (potentially stale) HTTP response.
  const replayDoneRef = useRef(false)
  // Track current buildId in a ref for use inside socket handlers
  const buildIdRef    = useRef(buildId)

  // Keep ref in sync
  useEffect(() => {
    buildIdRef.current = buildId
  }, [buildId])

  // ── Effect 1: Fetch build data ─────────────────────────────────────────────
  useEffect(() => {
    if (!buildId) {
      setBuild(null)
      setLogLines([])
      setError(null)
      replayDoneRef.current = false
      return
    }

    // Reset for new build
    setBuild(null)
    setLogLines([])
    setError(null)
    replayDoneRef.current = false

    let cancelled = false

    async function fetch_() {
      setLoading(true)
      try {
        const res = await fetch(`${BACKEND_URL}/builds/${buildId}`, {
          credentials: 'include',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const { build: row } = await res.json()
        if (cancelled) return

        setBuild(row)

        // Only seed from HTTP if socket replay hasn't already populated lines
        if (!replayDoneRef.current && row.logs) {
          const stored = row.logs
            .split('\n')
            .filter(Boolean)
            .map((line, i) => ({ id: `stored-${i}`, line, stream: 'stdout', ts: 0 }))
          setLogLines(stored)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetch_()
    return () => { cancelled = true }
  }, [buildId])

  // ── Effect 2: Socket event listeners — registered ONCE, never re-registered
  // All handler logic reads from refs so they never go stale.
  useEffect(() => {
    if (!socket) return

    const onReplay = ({ buildId: id, lines, status }) => {
      if (Number(id) !== Number(buildIdRef.current)) return
      replayDoneRef.current = true

      const entries = (lines ?? [])
        .filter(l => l?.line)
        .map((l, i) => ({
          id:     `replay-${i}`,
          line:   l.line,
          stream: l.stream ?? 'stdout',
          ts:     l.ts ?? 0,
        }))

      // Replace — replay is authoritative, always complete
      setLogLines(entries)
      if (status) setBuild(prev => prev ? { ...prev, status } : prev)
    }

    const onLog = ({ buildId: id, line, stream, ts }) => {
      if (Number(id) !== Number(buildIdRef.current)) return
      // Functional updater — always has current array, never stale closure
      setLogLines(prev => [
        ...prev,
        {
          id:     `live-${ts}-${Math.random().toString(36).slice(2, 7)}`,
          line,
          stream: stream ?? 'stdout',
          ts,
        },
      ])
    }

    const onUpdate = ({ build: updated }) => {
      if (Number(updated?.id) !== Number(buildIdRef.current)) return
      setBuild(prev => ({ ...(prev ?? {}), ...updated }))
    }

    socket.on('build:replay', onReplay)
    socket.on('build:log',    onLog)
    socket.on('build:update', onUpdate)

    // Cleanup only on unmount (socket is a stable module-level reference,
    // so this effect truly runs once)
    return () => {
      socket.off('build:replay', onReplay)
      socket.off('build:log',    onLog)
      socket.off('build:update', onUpdate)
    }
  }, [socket]) // ← socket is the stable module singleton; this fires once

  // ── Effect 3: Room join/leave ──────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !buildId) return

    socket.emit('build:join', buildId)

    return () => {
      socket.emit('build:leave', buildId)
    }
  }, [socket, buildId])

  return { build, logLines, loading, error }
}