/**
 * hooks/useBuildDetail.js
 *
 * Fetches a single build, joins its Socket.IO room, and maintains live state.
 *
 * ── Hybrid approach: Socket.IO + polling fallback ─────────────────────────────
 * Socket.IO delivers live events when the connection is healthy. But on Render
 * free tier, WebSocket connections are unreliable — the backend may process
 * batches faster than the socket can deliver them, or the connection may silently
 * stall. Rather than debugging the socket in isolation, we add a polling fallback:
 *
 *   • While build.status === 'running', poll GET /builds/:id every 3 seconds
 *   • Each poll response updates both the build metadata AND log lines
 *   • Socket.IO events still apply on top — whichever arrives first wins
 *   • Polling stops the moment status becomes 'success' or 'failed'
 *
 * This guarantees the panel ALWAYS reaches the final state, even if every
 * single Socket.IO event was dropped.
 */

import { useEffect, useState, useRef, useCallback } from 'react'

const BACKEND_URL  = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'
const POLL_INTERVAL = 1500  // ms — how often to re-fetch while running

/**
 * @param {number | null}                       buildId
 * @param {import('socket.io-client').Socket}   socket
 */
export function useBuildDetail(buildId, socket) {
  const [build,    setBuild]    = useState(null)
  const [logLines, setLogLines] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // Current build status in a ref so the poll interval can read it
  // without being in its dependency array
  const statusRef     = useRef('queued')
  const pollTimer     = useRef(null)
  const buildIdRef    = useRef(buildId)
  const mountedRef    = useRef(true)

  useEffect(() => {
    buildIdRef.current = buildId
  }, [buildId])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── Fetch helper ───────────────────────────────────────────────────────────
  const fetchBuild = useCallback(async (id, { silent = false } = {}) => {
    if (!id || !mountedRef.current) return
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/builds/${id}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { build: row } = await res.json()
      if (!mountedRef.current) return

      setBuild(row)
      statusRef.current = row.status

      // Rebuild logLines from the stored blob on every poll
      // This is the reliable source of truth — socket events are bonus speed
      if (row.logs) {
        const lines = row.logs
          .split('\n')
          .filter(Boolean)
          .map((line, i) => ({ id: `fetched-${i}`, line, stream: 'stdout', ts: i }))
        setLogLines(lines)
      } else {
        setLogLines([])
      }

      return row
    } catch (err) {
      if (!silent && mountedRef.current) setError(err.message)
    } finally {
      if (!silent && mountedRef.current) setLoading(false)
    }
  }, [])

  // ── Polling loop ───────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const startPolling = useCallback((id) => {
    stopPolling()
    pollTimer.current = setInterval(async () => {
      const row = await fetchBuild(id, { silent: true })
      // Stop polling once the build reaches a terminal state
      if (row && (row.status === 'success' || row.status === 'failed')) {
        stopPolling()
      }
    }, POLL_INTERVAL)
  }, [fetchBuild, stopPolling])

  // ── Effect 1: Initial fetch + start polling ────────────────────────────────
  useEffect(() => {
    if (!buildId) {
      setBuild(null)
      setLogLines([])
      setError(null)
      stopPolling()
      return
    }

    setBuild(null)
    setLogLines([])
    setError(null)
    statusRef.current = 'queued'

    fetchBuild(buildId).then(row => {
      if (row && (row.status === 'running' || row.status === 'queued')) {
        startPolling(buildId)
      }
    })

    return () => stopPolling()
  }, [buildId, fetchBuild, startPolling, stopPolling])

  // ── Effect 2: Socket listeners ─────────────────────────────────────────────
  // Socket events update state optimistically (faster than the 3s poll).
  // The poll acts as the guaranteed fallback.
  useEffect(() => {
    if (!socket) return

    const onLog = ({ buildId: id, line, stream, ts }) => {
      if (Number(id) !== Number(buildIdRef.current)) return
      setLogLines(prev => {
        // Avoid duplicates if poll already added this line
        const lastLine = prev[prev.length - 1]
        if (lastLine?.line === line) return prev
        return [...prev, {
          id: `live-${ts}-${Math.random().toString(36).slice(2, 7)}`,
          line, stream: stream ?? 'stdout', ts,
        }]
      })
    }

    const onUpdate = ({ build: updated }) => {
      if (Number(updated?.id) !== Number(buildIdRef.current)) return
      setBuild(prev => ({ ...(prev ?? {}), ...updated }))
      statusRef.current = updated.status
      // If build just finished, do one final fetch to get complete logs
      if (updated.status === 'success' || updated.status === 'failed') {
        stopPolling()
        fetchBuild(buildIdRef.current, { silent: true })
      }
    }

    const onReplay = ({ buildId: id, lines, status }) => {
      if (Number(id) !== Number(buildIdRef.current)) return
      if (!lines?.length) return
      const entries = lines
        .filter(l => l?.line)
        .map((l, i) => ({ id: `replay-${i}`, line: l.line, stream: l.stream ?? 'stdout', ts: l.ts ?? i }))
      setLogLines(entries)
      if (status) {
        setBuild(prev => prev ? { ...prev, status } : prev)
        statusRef.current = status
      }
    }

    socket.on('build:log',    onLog)
    socket.on('build:update', onUpdate)
    socket.on('build:replay', onReplay)

    return () => {
      socket.off('build:log',    onLog)
      socket.off('build:update', onUpdate)
      socket.off('build:replay', onReplay)
    }
  }, [socket, fetchBuild, stopPolling])

  // ── Effect 3: Room join/leave ──────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !buildId) return
    socket.emit('build:join', buildId)
    return () => socket.emit('build:leave', buildId)
  }, [socket, buildId])

  return { build, logLines, loading, error }
}