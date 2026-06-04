'use strict';

/**
 * backend/src/socket.js
 *
 * Singleton wrapper around the Socket.IO server instance.
 *
 * ── Key design decisions ─────────────────────────────────────────────────────
 *
 * ROOMS
 *   Every active build gets its own room: `build:<buildId>`
 *   Clients join when they open a build detail page, leave on navigation away.
 *
 * LOG REPLAY ON JOIN  ← critical for production reliability
 *   When a client joins a build room, we immediately replay all stored log
 *   lines from the DB. This solves the most common production failure mode:
 *     • User opens the dashboard mid-build
 *     • build:join fires AFTER the first N batches have already been emitted
 *     • Without replay, the terminal starts from wherever the live stream is,
 *       dropping everything that happened before the join
 *   With replay, the client gets a full catch-up burst first, then live lines
 *   continue seamlessly on top.
 *
 * EVENTS EMITTED BY THE SERVER
 *   build:queued   — new build inserted          payload: { build }
 *   build:update   — status changed              payload: { build }
 *   build:log      — one log line from worker    payload: { buildId, line, stream, ts }
 *   build:replay   — historical log burst        payload: { buildId, lines: [...] }
 */

const { Server }  = require('socket.io');
const { getPool } = require('./db');

/** @type {import('socket.io').Server | null} */
let _io = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialise the Socket.IO server. Must be called exactly once in index.js
 * before any route module imports getIO().
 *
 * @param {import('http').Server} httpServer
 * @param {string[]} allowedOrigins
 * @returns {import('socket.io').Server}
 */
function init(httpServer, allowedOrigins = []) {
  if (_io) {
    throw new Error('[socket] init() called more than once — this is a bug');
  }

  _io = new Server(httpServer, {
    cors: {
      origin:      allowedOrigins.length > 0 ? allowedOrigins : '*',
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    transports:    ['websocket', 'polling'],
    pingTimeout:   20_000,
    pingInterval:  25_000,
    // Allow larger payloads for replay bursts (default is 1MB, fine for logs)
    maxHttpBufferSize: 2e6,
  });

  _io.on('connection', (socket) => {
    console.log(`[socket] connected  id=${socket.id} ip=${socket.handshake.address}`);

    // ── build:join ────────────────────────────────────────────────────────────
    // Client opens a build detail page. We:
    //   1. Add socket to the room
    //   2. Replay all historical log lines from the DB immediately
    // This guarantees the terminal is always complete regardless of when the
    // user opened the page relative to the build's progress.
    socket.on('build:join', async (buildId) => {
      if (!isValidBuildId(buildId)) {
        socket.emit('error', { message: 'Invalid buildId' });
        return;
      }

      const room = `build:${buildId}`;
      socket.join(room);
      console.log(`[socket] ${socket.id} joined ${room}`);

      // Replay stored logs so late-joiners see the full history
      try {
        const pool = getPool();
        const { rows } = await pool.query(
          `SELECT logs, status FROM builds WHERE id = $1`,
          [Number(buildId)],
        );

        if (rows.length > 0 && rows[0].logs) {
          const storedLines = rows[0].logs
            .split('\n')
            .filter(Boolean)
            .map((line) => ({ line, stream: 'stdout', ts: null }));

          if (storedLines.length > 0) {
            // Send as a single replay burst — client renders these before
            // any live build:log events arrive
            socket.emit('build:replay', {
              buildId,
              lines:  storedLines,
              status: rows[0].status,
            });
            console.log(`[socket] replayed ${storedLines.length} lines to ${socket.id} for build ${buildId}`);
          }
        }
      } catch (err) {
        console.error(`[socket] log replay failed for build ${buildId}:`, err.message);
        // Non-fatal — live streaming still works; client just won't see history
      }
    });

    // ── build:leave ───────────────────────────────────────────────────────────
    socket.on('build:leave', (buildId) => {
      if (!isValidBuildId(buildId)) return;
      const room = `build:${buildId}`;
      socket.leave(room);
      console.log(`[socket] ${socket.id} left ${room}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected id=${socket.id} reason=${reason}`);
    });

    socket.on('error', (err) => {
      console.error(`[socket] error id=${socket.id}`, err);
    });
  });

  console.log('[socket] Socket.IO server initialised');
  return _io;
}

// ─── Accessor ─────────────────────────────────────────────────────────────────

/**
 * @returns {import('socket.io').Server}
 */
function getIO() {
  if (!_io) {
    throw new Error(
      '[socket] getIO() called before init() — ensure socket.init() runs in index.js first',
    );
  }
  return _io;
}

// ─── Emit helpers ─────────────────────────────────────────────────────────────

/** Broadcast to ALL clients: a new build was queued. */
function emitBuildQueued(build) {
  getIO().emit('build:queued', { build });
}

/** Broadcast to ALL clients: a build's status changed. */
function emitBuildUpdate(build) {
  getIO().emit('build:update', { build });
}

/**
 * Emit one log line to clients watching a specific build.
 *
 * @param {number|string}      buildId
 * @param {string}             line
 * @param {'stdout'|'stderr'}  stream
 * @param {number}             [ts]   Unix ms timestamp
 */
function emitBuildLog(buildId, line, stream = 'stdout', ts = Date.now()) {
  if (!isValidBuildId(buildId)) return;
  getIO().to(`build:${buildId}`).emit('build:log', { buildId, line, stream, ts });
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Accepts positive integers (DB serial IDs) or UUID-v4 strings.
 * @param {unknown} buildId
 * @returns {boolean}
 */
function isValidBuildId(buildId) {
  if (buildId == null) return false;
  const s = String(buildId);
  if (/^\d+$/.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) return true;
  return false;
}

module.exports = { init, getIO, emitBuildQueued, emitBuildUpdate, emitBuildLog };