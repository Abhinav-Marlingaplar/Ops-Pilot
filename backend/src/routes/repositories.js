/**
 * backend/src/routes/repositories.js  (Phase 2)
 *
 * Routes:
 *   GET  /repos/github          → list user's GitHub repos (from GitHub API)
 *   GET  /repos                 → list user's connected repos (from our DB)
 *   POST /repos                 → connect a repo (register GitHub webhook)
 *   DELETE /repos/:id           → disconnect a repo (delete GitHub webhook)
 */

'use strict';

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const { getPool }    = require('../db');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

const BACKEND_WEBHOOK_URL = process.env.WEBHOOK_PUBLIC_URL;
// e.g. https://your-app.onrender.com/webhook/github
// For local dev, use a tunnel like ngrok: https://abc.ngrok.io/webhook/github

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * GitHub API client authenticated as the current user.
 */
function githubClient(token) {
  return axios.create({
    baseURL: 'https://api.github.com',
    headers: {
      Authorization:        `Bearer ${token}`,
      Accept:               'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

/**
 * Register a webhook on a GitHub repo.
 * Returns the webhook id assigned by GitHub.
 *
 * @param {string} token        GitHub OAuth token
 * @param {string} fullName     e.g. "owner/repo"
 * @param {string} secret       HMAC secret for payload verification
 * @returns {Promise<number>}   GitHub webhook id
 */
async function registerGitHubWebhook(token, fullName, secret) {
  const gh = githubClient(token);

  const { data } = await gh.post(`/repos/${fullName}/hooks`, {
    name:   'web',
    active: true,
    events: ['push'],
    config: {
      url:          `${BACKEND_WEBHOOK_URL}`,
      content_type: 'json',
      secret,
      insecure_ssl: '0',
    },
  });

  return data.id;
}

/**
 * Delete a webhook from GitHub.
 * Fails silently if the webhook no longer exists on GitHub.
 *
 * @param {string} token
 * @param {string} fullName
 * @param {number} webhookId
 */
async function deleteGitHubWebhook(token, fullName, webhookId) {
  try {
    const gh = githubClient(token);
    await gh.delete(`/repos/${fullName}/hooks/${webhookId}`);
  } catch (err) {
    // 404 means webhook was already deleted — not an error
    if (err.response?.status !== 404) {
      console.warn(`[repos] Failed to delete GitHub webhook ${webhookId}:`, err.message);
    }
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /repos/github
 *
 * Fetches the authenticated user's repos from GitHub API.
 * Returns repos the user has push access to (can register webhooks).
 * Marks which ones are already connected in our DB.
 *
 * Query params:
 *   page  — GitHub page number (default 1)
 *   per_page — results per page (default 30, max 100)
 */
router.get('/github', requireUser, async (req, res, next) => {
  try {
    const { page = 1, per_page = 30 } = req.query;
    const gh = githubClient(req.user.github_token);

    // Fetch repos where user has push access
    const { data: ghRepos } = await gh.get('/user/repos', {
      params: {
        sort:      'updated',
        direction: 'desc',
        per_page:  Math.min(Number(per_page), 100),
        page:      Number(page),
        affiliation: 'owner,collaborator',
      },
    });

    // Get already-connected repo IDs from our DB
    const pool = getPool();
    const { rows: connected } = await pool.query(
      'SELECT github_repo_id FROM repositories WHERE user_id = $1 AND is_active = TRUE',
      [req.user.id],
    );
    const connectedIds = new Set(connected.map(r => r.github_repo_id));

    // Shape the response
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
      connected:      connectedIds.has(r.id),
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
 * Returns the current user's connected repositories from our DB.
 */
router.get('/', requireUser, async (req, res, next) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, github_repo_id, full_name, clone_url, default_branch,
              webhook_id, is_active, created_at
       FROM repositories
       WHERE user_id = $1 AND is_active = TRUE
       ORDER BY created_at DESC`,
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
 *   1. Generate a per-repo HMAC secret
 *   2. Register a webhook on GitHub pointing at our /webhook/github endpoint
 *   3. Insert a row into the repositories table
 *
 * Body: { github_repo_id, full_name, clone_url, default_branch }
 */
router.post('/', requireUser, async (req, res, next) => {
  try {
    const { github_repo_id, full_name, clone_url, default_branch = 'main' } = req.body ?? {};

    if (!github_repo_id || !full_name || !clone_url) {
      return res.status(400).json({ error: 'github_repo_id, full_name, and clone_url are required' });
    }

    const pool = getPool();

    // Check if a row already exists (active or inactive)
    const { rows: existing } = await pool.query(
      'SELECT id, is_active FROM repositories WHERE user_id = $1 AND github_repo_id = $2',
      [req.user.id, github_repo_id],
    );

    if (existing.length > 0) {

      // Already active
      if (existing[0].is_active) {
        return res.status(409).json({
          error: 'Repository already connected'
        });
      }
    
      // Reactivate existing inactive repo
      await pool.query(
        `UPDATE repositories
         SET is_active = TRUE
         WHERE id = $1`,
        [existing[0].id]
      );
    
      return res.json({
        message: 'Repository reconnected'
      });
    }

    // Generate a unique HMAC secret for this repo's webhook
    const webhookSecret = crypto.randomBytes(32).toString('hex');

    // Register webhook on GitHub (skip if no public URL configured — local dev)
    let webhookId = null;
    if (BACKEND_WEBHOOK_URL) {
      try {
        webhookId = await registerGitHubWebhook(
          req.user.github_token,
          full_name,
          webhookSecret,
        );
        console.log(`[repos] Webhook registered: ${full_name} → id=${webhookId}`);
      } catch (ghErr) {
        console.error('[repos] GitHub webhook registration failed:', ghErr.response?.data ?? ghErr.message);
        return res.status(502).json({
          error: 'Failed to register GitHub webhook',
          detail: ghErr.response?.data?.message ?? ghErr.message,
        });
      }
    } else {
      console.warn('[repos] WEBHOOK_PUBLIC_URL not set — skipping GitHub webhook registration');
    }

    // Insert into DB
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
 *   1. Delete the webhook from GitHub
 *   2. Mark the repo as inactive in our DB (soft delete)
 */
router.delete('/:id', requireUser, async (req, res, next) => {
  try {
    const repoId = Number(req.params.id);
    if (!Number.isInteger(repoId) || repoId <= 0) {
      return res.status(400).json({ error: 'Invalid repo id' });
    }

    const pool = getPool();

    // Fetch the repo — verify it belongs to this user
    const { rows } = await pool.query(
      'SELECT * FROM repositories WHERE id = $1 AND user_id = $2 AND is_active = TRUE',
      [repoId, req.user.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    const repo = rows[0];

    // Delete webhook from GitHub
    if (repo.webhook_id) {
      await deleteGitHubWebhook(req.user.github_token, repo.full_name, repo.webhook_id);
    }

    // Soft delete in DB
    await pool.query(
      'UPDATE repositories SET is_active = FALSE WHERE id = $1',
      [repoId],
    );

    console.log(`[repos] Disconnected: ${repo.full_name} (user=${req.user.id})`);
    res.json({ message: 'Repository disconnected' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;