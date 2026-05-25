/**
 * hooks/useBuildDetail.js
 *
 * Fetches a single build row on mount, then:
 *  1. Joins the `build:<id>` Socket.IO room
 *  2. Subscribes to `build:log` events — appends each line to `logLines`
 *  3. Subscribes to `build:update` events — merges status changes into `build`
 *  4. Leaves the room and unsubscribes on unmount
 *
 * `logLines` is an array of `{ line, stream, ts }` objects — the terminal
 * component renders them one per row.
 */

import { useEffect, useState, useCallback, useRef } from 'react'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'
const TOKEN       = import.meta.env.VITE_JWT_TOKEN    ?? ''

/**
 * @param {number | null}                            buildId
 * @param {import('socket.io-client').Socket | null} socket
 */
export function useBuildDetail(buildId, socket) {
  const [build,     setBuild]     = useState(null)
  const [logLines,  setLogLines]  = useState([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const joinedRoom  = useRef(null)

  // ── Fetch build detail (includes stored log blob for completed builds) ────
  const fetchDetail = useCallback(async (id) => {
    if (!id) return
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${BACKEND_URL}/builds/${id}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { build: row } = await res.json()
      setBuild(row)

      // Seed the log terminal with stored log lines (for completed builds)
      if (row.logs) {
        const stored = row.logs
          .split('\n')
          .filter(l => l.length > 0)
          .map((line, i) => ({ id: `stored-${i}`, line, stream: 'stdout', ts: 0 }))
        setLogLines(stored)
      } else {
        setLogLines([])
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!buildId) {
      setBuild(null)
      setLogLines([])
      return
    }
    fetchDetail(buildId)
  }, [buildId, fetchDetail])

  // ── Socket.IO room subscription ───────────────────────────────────────────
  useEffect(() => {
    if (!socket || !buildId) return

    // Leave previous room if switching builds
    if (joinedRoom.current && joinedRoom.current !== buildId) {
      socket.emit('build:leave', joinedRoom.current)
    }

    socket.emit('build:join', buildId)
    joinedRoom.current = buildId

    const onLog = ({ line, stream, ts }) => {
      setLogLines(prev => [
        ...prev,
        { id: `live-${ts}-${Math.random()}`, line, stream, ts },
      ])
    }

    const onUpdate = ({ build: updated }) => {
      if (Number(updated.id) === Number(buildId)) {
        setBuild(prev => ({ ...prev, ...updated }))
      }
    }

    socket.on('build:log',    onLog)
    socket.on('build:update', onUpdate)

    return () => {
      socket.emit('build:leave', buildId)
      socket.off('build:log',    onLog)
      socket.off('build:update', onUpdate)
      joinedRoom.current = null
    }
  }, [socket, buildId])

  return { build, logLines, loading, error }
}