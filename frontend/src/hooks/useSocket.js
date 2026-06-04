/**
 * hooks/useSocket.js
 *
 * Manages the Socket.IO client connection lifecycle.
 *
 * ── Critical fix ─────────────────────────────────────────────────────────────
 * The socket instance is stored in both a ref AND state. The ref gives stable
 * imperative access (emit, on, off). The state value causes dependents to
 * re-render once the socket is ready, so useBuildDetail's useEffect actually
 * fires with a real socket instead of null.
 *
 * The original implementation stored the socket only in a ref, which meant
 * `socketRef.current` was always null on the first render — the useEffect that
 * sets the ref runs after render. Components that received `socket` as a prop
 * saw null and never joined their build room.
 */

import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

/**
 * @returns {{
 *   socket:    import('socket.io-client').Socket | null,
 *   connected: boolean,
 * }}
 */
export function useSocket() {
  // Ref for stable imperative access across renders
  const socketRef = useRef(null)
  // State so dependents re-render when the socket becomes available
  const [socket,    setSocket]    = useState(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const s = io(SOCKET_URL, {
      transports:            ['websocket', 'polling'],
      autoConnect:           true,
      reconnectionAttempts:  Infinity,
      reconnectionDelay:     1_000,
      reconnectionDelayMax:  10_000,
      withCredentials:       true,
    })

    socketRef.current = s
    // Expose via state so consumers see the instance on next render
    setSocket(s)

    s.on('connect', () => {
      console.log('[socket] connected:', s.id)
      setConnected(true)
    })

    s.on('disconnect', (reason) => {
      console.log('[socket] disconnected:', reason)
      setConnected(false)
    })

    s.on('connect_error', (err) => {
      console.warn('[socket] connect_error:', err.message)
      setConnected(false)
    })

    return () => {
      s.disconnect()
      socketRef.current = null
      setSocket(null)
      setConnected(false)
    }
  }, [])

  return { socket, connected }
}