/**
 * backend/src/routes/auth.js
 *
 * GitHub OAuth 2.0 flow — two routes:
 *
 *   GET /auth/github          → redirects the browser to GitHub's consent page
 *   GET /auth/github/callback → exchanges code for token, upserts user, issues session
 *   POST /auth/logout         → destroys the session cookie
 *   GET /auth/me              → returns the authenticated user (used by frontend on load)
 *
 * Session strategy:
 *   After a successful OAuth callback we insert a row into the `sessions`
 *   table and send the session UUID back as an HttpOnly, SameSite=Lax cookie.
 *   Every subsequent API request is authenticated by looking up that UUID
 *   (see middleware/auth.js).  No JWT is issued to the browser — cookies are
 *   simpler and more secure for same-origin SPAs.
 *
 *   The worker-to-backend path still uses a static Bearer token set in the
 *   worker's .env (WORKER_JWT). The authenticateToken middleware handles both.
 */

'use strict';

const express  = require('express');
const axios    = require('axios');
const crypto   = require('crypto');
const { getPool } = require('../db');

const router = express.Router();

// ─── Config (validated at startup in index.js) ────────────────────────────────
const {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_CALLBACK_URL,   // e.g. https://your-app.onrender.com/auth/github/callback
  SESSION_COOKIE_SECRET, // used to sign the cookie value
  FRONTEND_URL,          // e.g. https://your-app.vercel.app
  NODE_ENV,
} = process.env;

const IS_PROD       = NODE_ENV === 'production';
const COOKIE_NAME   = 'cicd_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Exchange a GitHub OAuth code for an access token.
 * Returns the raw access_token string.
 *
 * @param {string} code
 * @returns {Promise<string>}
 */
async function exchangeCodeForToken(code) {
  const response = await axios.post(
    'https://github.com/login/oauth/access_token',
    {
      client_id:     GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    },
    { headers: { Accept: 'application/json' } },
  );

  const { access_token, error, error_description } = response.data;

  if (error || !access_token) {
    throw new Error(`GitHub token exchange failed: ${error_description ?? error ?? 'unknown'}`);
  }

  return access_token;
}

/**
 * Fetch the authenticated user's GitHub profile using their access token.
 *
 * @param {string} token
 * @returns {Promise<{ id: number, login: string, name: string, avatar_url: string }>}
 */
async function fetchGitHubUser(token) {
  const { data } = await axios.get('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  return data;
}

/**
 * Upsert a user row and return our internal user id.
 * Uses github_id as the stable key — login and avatar can change.
 *
 * @param {object} ghUser   GitHub API /user response
 * @param {string} token    GitHub OAuth access token
 * @returns {Promise<number>} Internal user id
 */
async function upsertUser(ghUser, token) {
  const pool = getPool();

  const { rows } = await pool.query(
    `INSERT INTO users (github_id, github_login, github_name, avatar_url, github_token, last_login_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (github_id) DO UPDATE SET
       github_login    = EXCLUDED.github_login,
       github_name     = EXCLUDED.github_name,
       avatar_url      = EXCLUDED.avatar_url,
       github_token    = EXCLUDED.github_token,
       last_login_at   = NOW()
     RETURNING id`,
    [ghUser.id, ghUser.login, ghUser.name ?? null, ghUser.avatar_url ?? null, token],
  );

  return rows[0].id;
}

/**
 * Create a session row and return the UUID.
 *
 * @param {number} userId
 * @param {object} req     Express request (for user-agent + IP)
 * @returns {Promise<string>} Session UUID
 */
async function createSession(userId, req) {
  const pool = getPool();

  const { rows } = await pool.query(
    `INSERT INTO sessions (user_id, user_agent, ip_address)
     VALUES ($1, $2, $3::inet)
     RETURNING id`,
    [
      userId,
      req.headers['user-agent'] ?? null,
      req.ip ?? null,
    ],
  );

  return rows[0].id;
}

/**
 * Set the session cookie on the response.
 *
 * @param {object} res        Express response
 * @param {string} sessionId  UUID from the sessions table
 */
function setSessionCookie(res, sessionId) {
  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly:  true,
    secure:    IS_PROD,          // HTTPS only in production
    sameSite:  'lax',            // CSRF protection; allows top-level navigations
    maxAge:    COOKIE_MAX_AGE,
    path:      '/',
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /auth/github
 *
 * Redirect the browser to GitHub's OAuth consent page.
 * We request the `repo` scope so we can register webhooks later.
 */
router.get('/github', (req, res) => {
  // `state` parameter prevents CSRF on the callback.
  // We store it in a short-lived cookie so we can verify it on return.
  const state = crypto.randomBytes(16).toString('hex');

  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: 'lax',
    maxAge:   10 * 60 * 1000, // 10 minutes
  });

  const params = new URLSearchParams({
    client_id:    GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_CALLBACK_URL,
    scope:        'read:user repo',  // repo scope needed for webhook registration
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

/**
 * GET /auth/github/callback
 *
 * GitHub redirects here after the user approves (or denies) the OAuth request.
 * On success: upsert user → create session → set cookie → redirect to dashboard.
 * On failure: redirect to login page with error query param.
 */
router.get('/github/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // ── OAuth denial or error from GitHub ───────────────────────────────────────
  if (error) {
    console.warn('[auth] GitHub OAuth denied:', error);
    return res.redirect(`${FRONTEND_URL}/login?error=oauth_denied`);
  }

  // ── CSRF state check ────────────────────────────────────────────────────────
  const storedState = req.cookies?.oauth_state;
  res.clearCookie('oauth_state');

  if (!storedState || storedState !== state) {
    console.warn('[auth] OAuth state mismatch — possible CSRF attempt');
    return res.redirect(`${FRONTEND_URL}/login?error=state_mismatch`);
  }

  if (!code) {
    return res.redirect(`${FRONTEND_URL}/login?error=no_code`);
  }

  // ── Exchange code → token → user → session ──────────────────────────────────
  try {
    const token    = await exchangeCodeForToken(code);
    const ghUser   = await fetchGitHubUser(token);
    const userId   = await upsertUser(ghUser, token);
    const sessionId = await createSession(userId, req);

    setSessionCookie(res, sessionId);

    console.log(`[auth] User logged in: ${ghUser.login} (id=${userId})`);

    // Redirect to dashboard — frontend picks up the cookie automatically
    return res.redirect(`${FRONTEND_URL}/#/dashboard`);
  } catch (err) {
    console.error('[auth] OAuth callback error:', err.message);
    return res.redirect(`${FRONTEND_URL}/login?error=server_error`);
  }
});

/**
 * POST /auth/logout
 *
 * Deletes the session from the DB and clears the cookie.
 * Authenticated route — uses the session cookie.
 */
router.post('/logout', async (req, res) => {
  const sessionId = req.cookies?.[COOKIE_NAME];

  if (sessionId) {
    try {
      const pool = getPool();
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    } catch (err) {
      // Log but don't fail — client should still get the cleared cookie
      console.error('[auth] Session delete error:', err.message);
    }
  }

  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ message: 'Logged out' });
});

/**
 * GET /auth/me
 *
 * Returns the current user's public profile.
 * Called by the frontend on initial load to check auth state.
 * Returns 401 if not authenticated (no valid session cookie).
 */
router.get('/me', async (req, res) => {
  const sessionId = req.cookies?.[COOKIE_NAME];

  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const pool = getPool();

    const { rows } = await pool.query(
      `SELECT u.id, u.github_login, u.github_name, u.avatar_url, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1
         AND s.expires_at > NOW()`,
      [sessionId],
    );

    if (rows.length === 0) {
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.status(401).json({ error: 'Session expired' });
    }

    return res.json({ user: rows[0] });
  } catch (err) {
    console.error('[auth] /me error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;