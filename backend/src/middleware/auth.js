/**
 * backend/src/middleware/auth.js  (Phase 1 — rewritten)
 *
 * Two authentication strategies in a single middleware, tried in order:
 *
 *   1. Session cookie  — for browser clients (GitHub OAuth users)
 *      Looks up the `cicd_session` cookie value in the sessions table.
 *      Attaches { id, github_login, github_name, avatar_url } to req.user.
 *
 *   2. Bearer token    — for the worker service and any API clients
 *      Verifies the Authorization: Bearer <token> header against WORKER_JWT.
 *      Attaches { sub: 'worker', role: 'worker' } to req.user.
 *
 * Routes that need authentication use `requireAuth`.
 * Routes that need specifically a user (not the worker) use `requireUser`.
 * Routes that need specifically the worker use `requireWorker`.
 *
 * The /health and /auth/* routes bypass all middleware — they are registered
 * before this middleware is applied in index.js.
 */

'use strict';

const jwt     = require('jsonwebtoken');
const { getPool } = require('../db');

const COOKIE_NAME  = 'cicd_session';
const WORKER_JWT   = process.env.WORKER_JWT;
const JWT_SECRET   = process.env.JWT_SECRET;

if (!WORKER_JWT) {
  console.warn('[auth] WORKER_JWT not set — worker authentication will fail');
}
if (!JWT_SECRET) {
  console.warn('[auth] JWT_SECRET not set — Bearer token verification will fail');
}

// ─── Strategy 1: Session cookie ───────────────────────────────────────────────

/**
 * Try to authenticate via the session cookie.
 * Returns the user object on success, null otherwise.
 *
 * @param {object} req
 * @returns {Promise<object|null>}
 */
async function authenticateViaSession(req) {
  const sessionId = req.cookies?.[COOKIE_NAME];
  if (!sessionId) return null;

  // Basic UUID format check — prevents unnecessary DB queries from malformed cookies
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(sessionId)) return null;

  try {
    const pool = getPool();

    const { rows } = await pool.query(
      `SELECT u.id, u.github_login, u.github_name, u.avatar_url, u.github_token
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id    = $1
         AND s.expires_at > NOW()`,
      [sessionId],
    );

    if (rows.length === 0) return null;

    return { ...rows[0], role: 'user' };
  } catch (err) {
    console.error('[auth] Session lookup error:', err.message);
    return null;
  }
}

// ─── Strategy 2: Bearer token (worker / API clients) ────────────────────────

/**
 * Try to authenticate via Authorization: Bearer <token>.
 * Returns a synthetic user object on success, null otherwise.
 *
 * We support two bearer token formats:
 *   a) Static WORKER_JWT env var — simplest, used by the worker
 *   b) Signed JWT (JWT_SECRET) — used by any other API client
 *
 * @param {object} req
 * @returns {object|null}
 */
function authenticateViaBearer(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  // ── a) Static worker token ─────────────────────────────────────────────────
  if (WORKER_JWT && token === WORKER_JWT) {
    return { sub: 'worker', role: 'worker' };
  }

  // ── b) Signed JWT ──────────────────────────────────────────────────────────
  if (JWT_SECRET) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      return { ...payload, role: payload.role ?? 'api_client' };
    } catch {
      // invalid or expired JWT — fall through to unauthenticated
    }
  }

  return null;
}

// ─── Middleware exports ───────────────────────────────────────────────────────

/**
 * requireAuth
 *
 * Accepts either a valid session cookie or a valid Bearer token.
 * Attaches the resolved identity to req.user.
 * Responds 401 if neither strategy succeeds.
 */
async function requireAuth(req, res, next) {
  // Try session first (browser clients)
  const sessionUser = await authenticateViaSession(req);
  if (sessionUser) {
    req.user = sessionUser;
    return next();
  }

  // Fall back to Bearer token (worker, API clients)
  const bearerUser = authenticateViaBearer(req);
  if (bearerUser) {
    req.user = bearerUser;
    return next();
  }

  return res.status(401).json({ error: 'Authentication required' });
}

/**
 * requireUser
 *
 * Only allows human users authenticated via GitHub OAuth session.
 * Rejects workers and unauthenticated requests.
 * Use on routes that require a real user identity (repo list, dashboard, etc.)
 */
async function requireUser(req, res, next) {
  const sessionUser = await authenticateViaSession(req);

  if (!sessionUser) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  req.user = sessionUser;
  return next();
}

/**
 * requireWorker
 *
 * Only allows the worker service (Bearer WORKER_JWT or signed JWT with role=worker).
 * Rejects browser sessions and unauthenticated requests.
 * Use on routes called only by the worker (POST /builds/status, POST /builds/:id/logs).
 */
function requireWorker(req, res, next) {
  const bearerUser = authenticateViaBearer(req);

  if (!bearerUser || bearerUser.role !== 'worker') {
    return res.status(403).json({ error: 'Worker access only' });
  }

  req.user = bearerUser;
  return next();
}

/**
 * optionalAuth
 *
 * Attaches req.user if a valid credential is present, but never rejects.
 * Use on routes that behave differently for authenticated vs anonymous users.
 */
async function optionalAuth(req, res, next) {
  const sessionUser = await authenticateViaSession(req);
  if (sessionUser) {
    req.user = sessionUser;
    return next();
  }

  const bearerUser = authenticateViaBearer(req);
  if (bearerUser) {
    req.user = bearerUser;
  }

  return next();
}

module.exports = { requireAuth, requireUser, requireWorker, optionalAuth };