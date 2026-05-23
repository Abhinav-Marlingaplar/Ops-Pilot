/**
 * backend/src/routes/repositories.js  (Phase 2)
 *
 * Routes:
 *   GET  /repos/github   → list user's GitHub repos (from GitHub API), merged with DB state
 *   GET  /repos          → list user's connected repos (from our DB)
 *   POST /repos          → connect a repo (register GitHub webhook)
 *   DELETE /repos/:id    → disconnect a repo (delete GitHub webhook, soft-delete row)
 */

'use strict';

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const { getPool }     = require('../db');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

const BACKEND_WEBHOOK_URL = process.env.WEBHOOK_PUBLIC_URL;
// Production: https://your-app.onrender.com/webhook/github
// Local dev:  use ngrok → https://abc.ngrok-free.app/webhook/github
// If unset, webhook registration is skipped (builds must be triggered manually).

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Axios instance pre-configured for the GitHub API as this user. */
function githubClient(token) {
  return axios.create({
    baseURL: 'https://api.github.com',
    headers: {
      Authorization:          `Bearer ${token}`,
      Accept:                 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

/**
 * Register a push webhook on a GitHub repo.
 * @returns {Promise<number>} GitHub-assigned webhook id
 */
async function registerGitHubWebhook(token, fullName, secret) {
  const gh = githubClient(token);
  const { data } = await gh.post(`/repos/${fullName}/hooks`, {
    name:   'web',
    active: true,
    events: ['push'],
    config: {
      url:          BACKEND_WEBHOOK_URL,
      content_type: 'json',
      secret,
      insecure_ssl: '0',
    },
  });
  return data.id;
}

/**
 * Remove a webhook from GitHub.
 * Silently swallows 404 (already deleted) — all other errors are re-thrown.
 */
async function deleteGitHubWebhook(token, fullName, webhookId) {
  try {
    const gh = githubClient(token);
    await gh.delete(`/repos/${fullName}/hooks/${webhookId}`);
  } catch (err) {
    if (err.response?.status !== 404) {
      console.warn(`[repos] Failed to delete GitHub webhook ${webhookId}:`, err.message);
    }
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /repos/github
 *
 * Returns the user's GitHub repos (sorted by last push).
 * Each repo is annotated with `connected: boolean` and `db_id: number|null`
 * so the frontend never needs a second round-trip to find the DB primary key.
 */
router.get('/github', requireUser, async (req, res, next) => {
  try {
    const { page = 1, per_page = 30 } = req.query;
    const gh   = githubClient(req.user.github_token);
    const pool = getPool();

    const [{ data: ghRepos }, { rows: dbRows }] = await Promise.all([
      gh.get('/user/repos', {
        params: {
          sort:        'updated',
          direction:   'desc',
          per_page:    Math.min(Number(per_page), 100),
          page:        Number(page),
          affiliation: 'owner,collaborator',
        },
      }),
      pool.query(
        'SELECT id, github_repo_id FROM repositories WHERE user_id = $1 AND is_active = TRUE',
        [req.user.id],
      ),
    ]);

    // Map github_repo_id (bigint → string from pg) to DB primary key
    const dbMap = new Map(dbRows.map(r => [String(r.github_repo_id), r.id]));

    const repos = ghRepos.map(r => ({
      github_repo_id: r.id,
      full_name:      r.full_name,
      description:    r.description ?? null,
      private:        r.private,
      default_branch: r.default_branch,
      clone_url:      r.clone_url,
      html_url:       r.html_url,
      pushed_at:      r.pushed_at,
      language:       r.language ?? null,
      stargazers:     r.stargazers_count,
      // Annotate with DB state — frontend uses db_id for DELETE /repos/:id
      connected:      dbMap.has(String(r.id)),
      db_id:          dbMap.get(String(r.id)) ?? null,
    }));

    res.json({ repos });
  } catch (err) {
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'GitHub token expired — please log in again' });
    }
    next(err);
  }
});

/**
 * GET /repos
 *
 * Returns the current user's active (connected) repositories from our DB.
 */
router.get('/', requireUser, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, github_repo_id, full_name, clone_url, default_branch,
              webhook_id, is_active, created_at
       FROM   repositories
       WHERE  user_id = $1 AND is_active = TRUE
       ORDER  BY created_at DESC`,
      [req.user.id],
    );
    res.json({ repos: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /repos
 *
 * Connect a repository:
 *   1. If an active row already exists → 409
 *   2. If an inactive row exists → reactivate it (fresh secret + new webhook)
 *   3. Otherwise → insert a new row
 */
router.post('/', requireUser, async (req, res, next) => {
  try {
    const { github_repo_id, full_name, clone_url, default_branch = 'main' } = req.body ?? {};

    if (!github_repo_id || !full_name || !clone_url) {
      return res.status(400).json({
        error: 'github_repo_id, full_name, and clone_url are required',
      });
    }

    const pool = getPool();

    const { rows: existing } = await pool.query(
      'SELECT id, is_active FROM repositories WHERE user_id = $1 AND github_repo_id = $2',
      [req.user.id, github_repo_id],
    );

    // ── Case 1: already active ──────────────────────────────────────────────
    if (existing.length > 0 && existing[0].is_active) {
      return res.status(409).json({ error: 'Repository already connected' });
    }

    // ── Register webhook (shared logic for both insert and reactivate) ──────
    const webhookSecret = crypto.randomBytes(32).toString('hex');
    let webhookId = null;

    if (BACKEND_WEBHOOK_URL) {
      try {
        webhookId = await registerGitHubWebhook(req.user.github_token, full_name, webhookSecret);
        console.log(`[repos] Webhook registered: ${full_name} → id=${webhookId}`);
      } catch (ghErr) {
        console.error('[repos] GitHub webhook registration failed:', ghErr.response?.data ?? ghErr.message);
        return res.status(502).json({
          error:  'Failed to register GitHub webhook',
          detail: ghErr.response?.data?.message ?? ghErr.message,
        });
      }
    } else {
      console.warn('[repos] WEBHOOK_PUBLIC_URL not set — skipping GitHub webhook registration');
    }

    // ── Case 2: inactive row exists → reactivate ────────────────────────────
    if (existing.length > 0 && !existing[0].is_active) {
      const { rows: updated } = await pool.query(
        `UPDATE repositories
         SET    is_active      = TRUE,
                webhook_id     = $1,
                webhook_secret = $2
         WHERE  id = $3
         RETURNING id, full_name, clone_url, default_branch, webhook_id, created_at`,
        [webhookId, webhookSecret, existing[0].id],
      );
      console.log(`[repos] Reconnected: ${full_name} (user=${req.user.id})`);
      return res.status(200).json({ repo: updated[0] });
    }

    // ── Case 3: no row → fresh insert ───────────────────────────────────────
    const { rows } = await pool.query(
      `INSERT INTO repositories
         (user_id, github_repo_id, full_name, clone_url, default_branch, webhook_id, webhook_secret, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       RETURNING id, full_name, clone_url, default_branch, webhook_id, created_at`,
      [req.user.id, github_repo_id, full_name, clone_url, default_branch, webhookId, webhookSecret],
    );

    console.log(`[repos] Connected: ${full_name} (user=${req.user.id})`);
    res.status(201).json({ repo: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /repos/:id
 *
 * Disconnect a repository:
 *   1. Verify the row belongs to this user and is active
 *   2. Delete the webhook from GitHub (non-fatal if already gone)
 *   3. Soft-delete in DB (is_active = FALSE) — row is kept for reconnect
 */
router.delete('/:id', requireUser, async (req, res, next) => {
  try {
    const repoId = Number(req.params.id);
    if (!Number.isInteger(repoId) || repoId <= 0) {
      return res.status(400).json({ error: 'Invalid repo id' });
    }

    const pool = getPool();

    const { rows } = await pool.query(
      'SELECT * FROM repositories WHERE id = $1 AND user_id = $2 AND is_active = TRUE',
      [repoId, req.user.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Repository not found or already disconnected' });
    }

    const repo = rows[0];

    // Remove webhook from GitHub (best-effort)
    if (repo.webhook_id) {
      await deleteGitHubWebhook(req.user.github_token, repo.full_name, repo.webhook_id);
    }

    // Soft-delete: keep row for potential reconnect, clear webhook reference
    await pool.query(
      'UPDATE repositories SET is_active = FALSE, webhook_id = NULL WHERE id = $1',
      [repoId],
    );

    console.log(`[repos] Disconnected: ${repo.full_name} (user=${req.user.id})`);
    res.json({ message: 'Repository disconnected' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;