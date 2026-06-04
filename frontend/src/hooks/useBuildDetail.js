/**
 * hooks/useBuildDetail.js
 *
 * Fetches a single build row on mount, then:
 *  1. Joins the `build:<id>` Socket.IO room
 *  2. Handles `build:replay` — a full log burst the server sends on join
 *     so late-joining clients see complete history
 *  3. Subscribes to `build:log` events — appends live lines as they arrive
 *  4. Subscribes to `build:update` — merges status changes into `build`
 *  5. Leaves the room and unsubscribes on unmount / build change
 *
 * ── Fix: room join timing ────────────────────────────────────────────────────
 * The socket is passed in as a prop. When it first becomes non-null (after the
 * useEffect in useSocket runs), this hook's useEffect fires and emits
 * `build:join`. The dependency array includes both `socket` AND `buildId` so
 * switching builds correctly leaves the old room and joins the new one.
 *
 * ── Fix: replay vs live deduplication ───────────────────────────────────────
 * The server sends `build:replay` with all stored lines immediately on join.
 * The initial `fetchDetail` call also returns stored logs. We use `replayDone`
 * to skip seeding from the HTTP response once a replay has arrived, avoiding
 * duplicate lines in the terminal.
 */

import { useEffect, useState, useCallback, useRef } from 'react'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

/**
 * @param {number | null}                            buildId
 * @param {import('socket.io-client').Socket | null} socket
 */
export function useBuildDetail(buildId, socket) {
  const [build,    setBuild]    = useState(null)
  const [logLines, setLogLines] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // Track which room we're currently in to avoid double-join on re-renders
  const joinedRoom = useRef(null)
  // Once a replay arrives, don't overwrite lines with the HTTP response
  const replayDone = useRef(false)

  // ── Fetch initial build data ───────────────────────────────────────────────
  const fetchDetail = useCallback(async (id) => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${BACKEND_URL}/builds/${id}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { build: row } = await res.json()
      setBuild(row)

      // Only seed log lines from HTTP if the socket hasn't already replayed them
      if (!replayDone.current && row.logs) {
        const stored = row.logs
          .split('\n')
          .filter(Boolean)
          .map((line, i) => ({ id: `stored-${i}`, line, stream: 'stdout', ts: 0 }))
        setLogLines(stored)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Reset and fetch when buildId changes
  useEffect(() => {
    if (!buildId) {
      setBuild(null)
      setLogLines([])
      setError(null)
      replayDone.current = false
      return
    }
    // Reset state for new build
    setBuild(null)
    setLogLines([])
    setError(null)
    replayDone.current = false
    fetchDetail(buildId)
  }, [buildId, fetchDetail])

  // ── Socket.IO room subscription ───────────────────────────────────────────
  useEffect(() => {
    // Wait until both socket and buildId are ready
    if (!socket || !buildId) return

    // Leave previous room if we switched builds
    if (joinedRoom.current !== null && joinedRoom.current !== buildId) {
      socket.emit('build:leave', joinedRoom.current)
    }

    // Join the new room — server will immediately send build:replay
    socket.emit('build:join', buildId)
    joinedRoom.current = buildId

    // ── build:replay — full historical log burst on join ─────────────────────
    // Replaces whatever the HTTP fetch returned to guarantee completeness.
    const onReplay = ({ buildId: id, lines, status }) => {
      if (Number(id) !== Number(buildId)) return
      replayDone.current = true

      const entries = (lines ?? [])
        .filter(l => l?.line)
        .map((l, i) => ({
          id:     `replay-${i}`,
          line:   l.line,
          stream: l.stream ?? 'stdout',
          ts:     l.ts ?? 0,
        }))

      setLogLines(entries)

      // Also sync the build status from replay metadata
      if (status) {
        setBuild(prev => prev ? { ...prev, status } : prev)
      }
    }

    // ── build:log — individual live line ─────────────────────────────────────
    const onLog = ({ buildId: id, line, stream, ts }) => {
      if (Number(id) !== Number(buildId)) return
      setLogLines(prev => [
        ...prev,
        { id: `live-${ts}-${Math.random().toString(36).slice(2)}`, line, stream, ts },
      ])
    }

    // ── build:update — status change ─────────────────────────────────────────
    const onUpdate = ({ build: updated }) => {
      if (Number(updated.id) !== Number(buildId)) return
      setBuild(prev => ({ ...prev, ...updated }))
    }

    socket.on('build:replay', onReplay)
    socket.on('build:log',    onLog)
    socket.on('build:update', onUpdate)

    return () => {
      socket.emit('build:leave', buildId)
      socket.off('build:replay', onReplay)
      socket.off('build:log',    onLog)
      socket.off('build:update', onUpdate)
      joinedRoom.current = null
    }
  }, [socket, buildId])  // ← both in deps: fires when socket becomes non-null AND when build changes

  return { build, logLines, loading, error }
}