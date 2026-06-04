/**
 * hooks/useSocket.js
 *
 * Manages the Socket.IO client connection lifecycle.
 *
 * ── Stability guarantee ───────────────────────────────────────────────────────
 * The socket object is created ONCE at module level and never replaced. Only
 * `connected` (a boolean) changes over time. This means:
 *   - Components that receive `socket` as a prop never re-render due to a new
 *     socket reference
 *   - useEffects with `socket` in their dep array fire exactly once (on mount)
 *     and not again on reconnect events
 *
 * Previous bug: calling setSocket(s) stored the instance in React state.
 * A state setter triggers a re-render → downstream useEffects saw a new
 * `socket` reference → teardown + re-subscribe → brief window with no
 * `build:log` listener → events dropped → terminal freezes.
 */

import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

// ── Module-level singleton ────────────────────────────────────────────────────
// Created once when the module is first imported. Never recreated. HMR in
// dev will recreate the module (and therefore this socket) on file save,
// which is fine — it just reconnects cleanly.
const _socket = io(SOCKET_URL, {
  transports:           ['websocket', 'polling'],
  autoConnect:          true,
  reconnectionAttempts: Infinity,
  reconnectionDelay:    1_000,
  reconnectionDelayMax: 10_000,
  withCredentials:      true,
})

/**
 * @returns {{ socket: import('socket.io-client').Socket, connected: boolean }}
 */
export function useSocket() {
  const [connected, setConnected] = useState(_socket.connected)

  useEffect(() => {
    const onConnect    = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    const onError      = (e) => {
      console.warn('[socket] connect_error:', e.message)
      setConnected(false)
    }

    _socket.on('connect',       onConnect)
    _socket.on('disconnect',    onDisconnect)
    _socket.on('connect_error', onError)

    // Sync state with actual connection status (may have connected before
    // this effect ran on first render)
    setConnected(_socket.connected)

    return () => {
      _socket.off('connect',       onConnect)
      _socket.off('disconnect',    onDisconnect)
      _socket.off('connect_error', onError)
    }
  }, []) // empty deps — register once, never re-register

  // Same reference every single render — never triggers downstream re-effects
  return { socket: _socket, connected }
}