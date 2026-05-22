/**
 * socket.js
 *
 * Singleton wrapper around the Socket.IO server instance.
 *
 * WHY a singleton?
 *   Express routes and the builds router live in separate modules. They all
 *   need to emit events, but none of them should own the io instance — that
 *   would create circular-require nightmares. Instead, index.js calls
 *   `init(httpServer)` once at boot, and every other module calls `getIO()`
 *   to grab the same instance.
 *
 * ROOMS
 *   Every active build gets its own Socket.IO room: `build:<buildId>`
 *   Clients join the room when they open a build's detail page, and leave
 *   when they navigate away. This means log-line events are only sent to
 *   clients that are actually watching that build — not broadcast to everyone.
 *
 * EVENTS EMITTED BY THE SERVER
 *   build:queued   — a new build row was inserted          payload: { build }
 *   build:update   — status changed (running/success/fail) payload: { build }
 *   build:log      — one log chunk from the worker         payload: { buildId, line, stream }
 */

'use strict';

const { Server } = require('socket.io');

/** @type {import('socket.io').Server | null} */
let _io = null;

/**
 * Initialise the Socket.IO server and attach it to the given HTTP server.
 * Must be called exactly once, before any route tries to emit.
 *
 * @param {import('http').Server} httpServer
 * @param {string[]} allowedOrigins  CORS origins that may connect (e.g. the
 *                                   React dev server + the production domain)
 * @returns {import('socket.io').Server}
 */
function init(httpServer, allowedOrigins = []) {
  if (_io) {
    throw new Error('[socket] init() called more than once — this is a bug');
  }

  _io = new Server(httpServer, {
    /*
     * CORS — Socket.IO has its own CORS layer separate from the Express one.
     * In production allowedOrigins will be the frontend domain. In dev it
     * includes localhost:5173 (Vite default).
     */
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
      methods: ['GET', 'POST'],
    },

    /*
     * Use only the WebSocket transport in production — avoids the polling
     * fallback overhead. Clients that can't do WS (rare) will simply fail to
     * connect rather than creating a long-polling session that hammers the
     * backend. Switch to ['polling', 'websocket'] if you need broader compat.
     */
    transports: ['websocket', 'polling'],

    /*
     * Ping settings — keep connections alive through load-balancer idle
     * timeouts (most ALBs default to 60s).
     */
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  _io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;
    console.log(`[socket] client connected  id=${socket.id} ip=${clientIp}`);

    /*
     * JOIN a build room.
     * The frontend emits this when the user opens a build detail page.
     * We validate the buildId so clients can't join arbitrary room names.
     */
    socket.on('build:join', (buildId) => {
      if (!isValidBuildId(buildId)) {
        socket.emit('error', { message: 'Invalid buildId' });
        return;
      }
      const room = `build:${buildId}`;
      socket.join(room);
      console.log(`[socket] ${socket.id} joined room ${room}`);
    });

    /*
     * LEAVE a build room.
     * The frontend emits this on unmount / navigation away.
     */
    socket.on('build:leave', (buildId) => {
      if (!isValidBuildId(buildId)) return;
      const room = `build:${buildId}`;
      socket.leave(room);
      console.log(`[socket] ${socket.id} left room ${room}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[socket] client disconnected id=${socket.id} reason=${reason}`);
    });

    socket.on('error', (err) => {
      console.error(`[socket] socket error id=${socket.id}`, err);
    });
  });

  console.log('[socket] Socket.IO server initialised');
  return _io;
}

/**
 * Return the initialised Socket.IO instance.
 * Throws if `init()` was never called — surfaces misconfiguration early.
 *
 * @returns {import('socket.io').Server}
 */
function getIO() {
  if (!_io) {
    throw new Error(
      '[socket] getIO() called before init() — ensure socket.init() runs in index.js before any route is registered',
    );
  }
  return _io;
}

// ─── Emit helpers ────────────────────────────────────────────────────────────
// These are thin wrappers so call-sites don't have to remember room naming
// conventions or event names.

/**
 * Broadcast to ALL connected clients that a new build was queued.
 * Used by the webhook route immediately after inserting the DB row.
 *
 * @param {object} build  The full build row from the DB
 */
function emitBuildQueued(build) {
  getIO().emit('build:queued', { build });
}

/**
 * Broadcast to ALL connected clients that a build's status changed.
 * Used by POST /builds/status when the worker reports back.
 *
 * @param {object} build  The updated build row from the DB
 */
function emitBuildUpdate(build) {
  getIO().emit('build:update', { build });
}

/**
 * Emit a log line to clients watching a specific build.
 * Only sockets in the `build:<buildId>` room receive this.
 *
 * @param {number|string} buildId
 * @param {string}        line    One line of stdout/stderr from the worker
 * @param {'stdout'|'stderr'} stream
 */
function emitBuildLog(buildId, line, stream = 'stdout') {
  if (!isValidBuildId(buildId)) return;
  getIO().to(`build:${buildId}`).emit('build:log', {
    buildId,
    line,
    stream,
    ts: Date.now(),
  });
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Validate a buildId before using it in a room name.
 * Accepts positive integers (DB serial IDs) or UUID-v4 strings.
 *
 * @param {unknown} buildId
 * @returns {boolean}
 */
function isValidBuildId(buildId) {
  if (buildId === null || buildId === undefined) return false;
  const str = String(buildId);
  // Numeric DB serial ID
  if (/^\d+$/.test(str)) return true;
  // UUID v4
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)) {
    return true;
  }
  return false;
}

module.exports = { init, getIO, emitBuildQueued, emitBuildUpdate, emitBuildLog };