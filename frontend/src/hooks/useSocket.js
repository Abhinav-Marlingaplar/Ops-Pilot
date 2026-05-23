/**
 * hooks/useSocket.js
 *
 * Manages the Socket.IO client connection lifecycle.
 * Returns the `socket` instance so components can subscribe to events
 * or emit messages directly.
 *
 * Features:
 *  - Connects once on mount, disconnects on unmount (no leaks)
 *  - Surfaces connection state (connected / disconnected / error)
 *  - Auto-reconnect is handled by the Socket.IO client library itself
 */

import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

/**
 * @returns {{ socket: import('socket.io-client').Socket | null, connected: boolean }}
 */
export function useSocket() {
  const socketRef = useRef(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    socketRef.current = socket

    socket.on('connect',            () => setConnected(true))
    socket.on('disconnect',         () => setConnected(false))
    socket.on('connect_error', (e) => {
      console.warn('[socket] connect_error:', e.message)
      setConnected(false)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  return { socket: socketRef.current, connected }
}

