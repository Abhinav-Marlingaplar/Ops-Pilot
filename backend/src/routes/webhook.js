/**
 * backend/src/routes/webhook.js  (Phase 2 — updated)
 *
 * Now handles TWO types of webhook:
 *
 *   POST /webhook
 *     Manual trigger — authenticated via session cookie or Bearer token.
 *     Same as before, used by the dashboard "Trigger Build" button.
 *
 *   POST /webhook/github
 *     Automatic GitHub push webhook — authenticated via HMAC-SHA256 signature.
 *     No session cookie needed — GitHub signs every payload with the
 *     per-repo secret we generated when the repo was connected.
 *
 * Security on /webhook/github:
 *   1. Verify X-Hub-Signature-256 header using the repo's stored webhook_secret
 *   2. Look up the repository by its GitHub repo id (from the payload)
 *   3. Only process 'push' events (ignore ping, PR, etc.)
 *   4. Only build the default branch (ignore feature branch pushes)
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');
const { getPool }         = require('../db');
const { getChannel }      = require('../queue');
const { requireAuth }     = require('../middleware/auth');
const { notifyBuildQueued } = require('./builds');

const router    = express.Router();
const QUEUE_NAME = 'build_jobs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Insert a build row, publish to RabbitMQ, emit Socket.IO event.
 * Shared by both the manual and GitHub webhook handlers.
 */
async function queueBuild({ repository, branch, commit, userId, repositoryId }) {
  const pool    = getPool();
  const channel = getChannel();

  const { rows } = await pool.query(
    `INSERT INTO builds (repository, branch, commit, status, user_id, repository_id, created_at)
     VALUES ($1, $2, $3, 'queued', $4, $5, NOW())
     RETURNING *`,
    [repository, branch, commit, userId ?? null, repositoryId ?? null],
  );
  const build = rows[0];

  const job = {
    buildId:      build.id,
    repository,
    branch,
    commit,
    triggeredAt:  new Date().toISOString(),
  };

  channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(job)), { persistent: true });

  try { notifyBuildQueued(build); } catch { /* non-fatal */ }

  return build;
}

// ─── POST /webhook — manual trigger (session/Bearer auth) ─────────────────────

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { repository, branch, commit } = req.body ?? {};

    if (!repository || typeof repository !== 'string' || !repository.trim()) {
      return res.status(400).json({ error: '`repository` is required' });
    }

    const build = await queueBuild({
      repository:   repository.trim(),
      branch:       (branch ?? 'main').trim(),
      commit:       (commit ?? 'HEAD').trim(),
      userId:       req.user.id ?? null,
      repositoryId: null,
    });

    console.log('[webhook] Manual build queued:', build.id);

    res.status(202).json({
      message: 'Build job queued',
      job: {
        id:         build.id,
        repository: build.repository,
        branch:     build.branch,
        commit:     build.commit,
        status:     'queued',
        triggeredAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /webhook/github — GitHub push event (HMAC auth) ─────────────────────

router.post('/github', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const event     = req.headers['x-github-event'];
    const signature = req.headers['x-hub-signature-256'];
    const delivery  = req.headers['x-github-delivery'];

    // ── Only handle push events ───────────────────────────────────────────────
    // Respond 200 to pings so GitHub marks the webhook as healthy
    if (event === 'ping') {
      console.log(`[webhook/github] Ping received (delivery=${delivery})`);
      return res.json({ message: 'pong' });
    }

    if (event !== 'push') {
      return res.status(200).json({ message: `Event '${event}' ignored` });
    }

    if (!signature) {
      return res.status(401).json({ error: 'Missing X-Hub-Signature-256' });
    }

    // ── Parse payload ─────────────────────────────────────────────────────────
    let payload;
    try {
      payload = JSON.parse(req.body.toString());
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    const githubRepoId = payload.repository?.id;
    const pushedBranch = payload.ref?.replace('refs/heads/', '');
    const commitSha    = payload.after;
    const cloneUrl     = payload.repository?.clone_url;

    if (!githubRepoId || !pushedBranch || !commitSha) {
      return res.status(400).json({ error: 'Incomplete push payload' });
    }

    // ── Look up repo in our DB ────────────────────────────────────────────────
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT r.*, u.id AS owner_id
       FROM repositories r
       JOIN users u ON u.id = r.user_id
       WHERE r.github_repo_id = $1 AND r.is_active = TRUE
       LIMIT 1`,
      [githubRepoId],
    );

    if (rows.length === 0) {
      // Repo not connected — return 200 so GitHub doesn't retry
      return res.status(200).json({ message: 'Repository not connected' });
    }

    const repo = rows[0];

    // ── Verify HMAC signature ─────────────────────────────────────────────────
    const expectedSig = `sha256=${crypto
      .createHmac('sha256', repo.webhook_secret)
      .update(req.body)
      .digest('hex')}`;

    const sigBuffer      = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);

    // timingSafeEqual prevents timing attacks
    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      console.warn(`[webhook/github] Invalid signature for repo ${repo.full_name}`);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // ── Only build the default branch ─────────────────────────────────────────
    if (pushedBranch !== repo.default_branch) {
      console.log(`[webhook/github] Ignoring push to non-default branch: ${pushedBranch}`);
      return res.status(200).json({ message: `Branch '${pushedBranch}' not tracked` });
    }

    // ── Queue the build ───────────────────────────────────────────────────────
    const build = await queueBuild({
      repository:   cloneUrl ?? repo.clone_url,
      branch:       pushedBranch,
      commit:       commitSha,
      userId:       repo.owner_id,
      repositoryId: repo.id,
    });

    console.log(`[webhook/github] Build queued: ${repo.full_name}@${commitSha.slice(0, 7)} → build #${build.id}`);

    // Respond quickly — GitHub expects a response within 10s
    res.status(202).json({ message: 'Build queued', buildId: build.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;