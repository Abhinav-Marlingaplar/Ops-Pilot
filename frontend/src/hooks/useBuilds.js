/**
 * hooks/useBuilds.js
 *
 * Fetches the initial build list from `GET /builds` and keeps it live via
 * Socket.IO events:
 *
 *  build:queued  → prepend the new build to the top of the list
 *  build:update  → find the matching build by id and update its fields in place
 *
 * The `newBuildIds` set tracks which builds were added since the component
 * mounted — used to trigger the slide-in animation only for genuinely new rows.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

/**
 * @param {import('socket.io-client').Socket | null} socket
 * @returns {{
 *   builds:      object[],
 *   loading:     boolean,
 *   error:       string | null,
 *   newBuildIds: Set<number>,
 *   refetch:     () => void,
 * }}
 */
export function useBuilds(socket) {
  const [builds,      setBuilds]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const newBuildIds                   = useRef(new Set())

  const fetchBuilds = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${BACKEND_URL}/builds`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { builds: rows } = await res.json()
      setBuilds(rows)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { fetchBuilds() }, [fetchBuilds])

  // Socket.IO live updates
  useEffect(() => {
    if (!socket) return

    const onQueued = ({ build }) => {
      newBuildIds.current.add(build.id)
      setBuilds(prev => {
        // Avoid duplicates (e.g. if we also polled in the background)
        if (prev.some(b => b.id === build.id)) return prev
        return [build, ...prev].slice(0, 20)
      })
    }

    const onUpdate = ({ build }) => {
      setBuilds(prev =>
        prev.map(b => b.id === build.id ? { ...b, ...build } : b)
      )
    }

    socket.on('build:queued', onQueued)
    socket.on('build:update', onUpdate)

    return () => {
      socket.off('build:queued', onQueued)
      socket.off('build:update', onUpdate)
    }
  }, [socket])

  return {
    builds,
    loading,
    error,
    newBuildIds: newBuildIds.current,
    refetch: fetchBuilds,
  }
}