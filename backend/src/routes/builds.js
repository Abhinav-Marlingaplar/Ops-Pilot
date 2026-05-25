/**
 * backend/src/routes/builds.js  (Week 4 — updated)
 *
 * Changes from Week 2/3:
 *  1. `POST /builds/status` now calls `emitBuildUpdate()` after updating the
 *     DB row so every connected dashboard client gets the new status instantly.
 *  2. `POST /builds/:id/logs` — NEW endpoint.
 *     The worker POSTs individual log chunks here as the pipeline runs.
 *     The route validates the build exists, appends the line to the DB, and
 *     immediately fans it out to any client watching that build via
 *     `emitBuildLog()`. This is what makes the live log terminal work.
 *  3. `GET /builds/:id` — NEW endpoint for the build detail page.
 *     Returns the full build row including all stored logs.
 *
 * All existing behaviour (POST /builds/status, GET /builds) is preserved.
 */

'use strict';

const express = require('express');
const { getPool }                                    = require('../db');
const { emitBuildUpdate, emitBuildLog, emitBuildQueued } = require('../socket');
const { requireAuth, requireWorker } = require('../middleware/auth');

const router = express.Router();

// ─── Auto-migrate helper ──────────────────────────────────────────────────────
// Adds any columns that didn't exist in Week 1's schema. Safe to run on every
// boot (IF NOT EXISTS is idempotent).

async function ensureColumns(pool) {
  await pool.query(`
    ALTER TABLE builds
      ADD COLUMN IF NOT EXISTS logs       TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS worker_id  VARCHAR(255),
      ADD COLUMN IF NOT EXISTS status     VARCHAR(50) DEFAULT 'queued';
  `);
}

let _migrated = false;
async function lazyMigrate(pool) {
  if (_migrated) return;
  await ensureColumns(pool);
  _migrated = true;
}

// ─── GET /builds ──────────────────────────────────────────────────────────────
// Returns the 20 most recent builds, newest first. Used by the dashboard list.

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    await lazyMigrate(pool);

    const { rows } = await pool.query(`
      SELECT id, repository, branch, commit, status, worker_id, created_at, updated_at
      FROM   builds
      ORDER  BY created_at DESC
      LIMIT  20
    `);

    res.json({ builds: rows });
  } catch (err) {
    next(err);
  }
});

// ─── GET /builds/:id ─────────────────────────────────────────────────────────
// Full build detail including stored logs. Used by the build detail page on
// initial load (before Socket.IO takes over for live streaming).

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const buildId = Number(req.params.id);
    if (!Number.isInteger(buildId) || buildId <= 0) {
      return res.status(400).json({ error: 'Invalid build id' });
    }

    const pool = getPool();
    await lazyMigrate(pool);

    const { rows } = await pool.query(
      `SELECT * FROM builds WHERE id = $1`,
      [buildId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Build not found' });
    }

    res.json({ build: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── POST /builds/status ─────────────────────────────────────────────────────
// Called by the worker at the END of a pipeline run with the final status and
// a full log blob. Also emits a Socket.IO `build:update` event so the
// dashboard updates in real-time without polling.

router.post('/status', requireWorker, async (req, res, next) => {
  try {
    const { repository, branch, commit, status, logs, workerId } = req.body ?? {};

    if (!repository || !status) {
      return res.status(400).json({ error: 'repository and status are required' });
    }

    const allowedStatuses = ['queued', 'running', 'success', 'failed'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowedStatuses.join(', ')}` });
    }

    const pool = getPool();
    await lazyMigrate(pool);

    // Find the most-recent build row that matches this job.
    // We match on repository + branch + commit because the worker doesn't
    // receive the DB-generated id in the queue message.
    const findResult = await pool.query(
      `SELECT id FROM builds
       WHERE  repository = $1
         AND  branch     = $2
         AND  commit     = $3
       ORDER  BY created_at DESC
       LIMIT  1`,
      [repository, branch ?? '', commit ?? 'HEAD'],
    );

    if (findResult.rows.length === 0) {
      return res.status(404).json({ error: 'No matching build found' });
    }

    const buildId = findResult.rows[0].id;

    const { rows } = await pool.query(
      `UPDATE builds
       SET    status     = $1,
              logs       = COALESCE($2, logs),
              worker_id  = $3,
              updated_at = NOW()
       WHERE  id         = $4
       RETURNING *`,
      [status, logs ?? null, workerId ?? null, buildId],
    );

    const updatedBuild = rows[0];

    console.log(
      `[backend] Build status updated: ${repository}@${commit ?? 'HEAD'} → ${status} (worker: ${workerId ?? 'unknown'})`,
    );

    // ── Socket.IO: push the update to all dashboard clients ──────────────────
    emitBuildUpdate(updatedBuild);

    res.json({ build: updatedBuild });
  } catch (err) {
    next(err);
  }
});

// ─── POST /builds/:id/logs ───────────────────────────────────────────────────
// Called by the worker repeatedly during a pipeline run — once per log line
// (or small chunk). Each call:
//   1. Appends the line to the `logs` TEXT column (newline-separated)
//   2. Emits a `build:log` Socket.IO event to clients watching this build
//
// This is what powers the live streaming terminal in the dashboard.
//
// Auth note: the worker uses the same JWT_SECRET-signed token as any other
// client, so this route is behind `authenticateToken` like the others.

router.post('/:id/logs', requireWorker, async (req, res, next) => {
  try {
    const buildId = Number(req.params.id);
    if (!Number.isInteger(buildId) || buildId <= 0) {
      return res.status(400).json({ error: 'Invalid build id' });
    }

    const { line, stream = 'stdout' } = req.body ?? {};

    if (typeof line !== 'string' || line.length === 0) {
      return res.status(400).json({ error: '`line` must be a non-empty string' });
    }

    if (line.length > 4096) {
      return res.status(400).json({ error: '`line` exceeds 4096 character limit' });
    }

    const allowedStreams = ['stdout', 'stderr'];
    if (!allowedStreams.includes(stream)) {
      return res.status(400).json({ error: '`stream` must be stdout or stderr' });
    }

    const pool = getPool();

    // Verify the build exists before accepting log lines.
    const check = await pool.query('SELECT id, status FROM builds WHERE id = $1', [buildId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Build not found' });
    }

    // Append line to the logs column. CONCAT handles the NULL-on-first-write case.
    await pool.query(
      `UPDATE builds
       SET logs = CONCAT(COALESCE(logs, ''::text), $1::text, E'\n'),
           updated_at = NOW()
       WHERE id = $2::integer`,
      [line, buildId],
    );

    // ── Socket.IO: stream the line to watching clients ────────────────────────
    emitBuildLog(buildId, line, stream);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /builds/:id/logs/batch ─────────────────────────────────────────────
// Worker POSTs arrays of log lines instead of one request per line.
// Reduces ~1800 HTTP requests per build down to ~36 batches of 50.

router.post('/:id/logs/batch', requireWorker, async (req, res, next) => {
  try {
    const buildId = Number(req.params.id);
    if (!Number.isInteger(buildId) || buildId <= 0) {
      return res.status(400).json({ error: 'Invalid build id' });
    }

    const { lines } = req.body ?? {};
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'lines must be a non-empty array' });
    }

    const pool = getPool();

    const check = await pool.query('SELECT id FROM builds WHERE id = $1', [buildId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Build not found' });
    }

    // Append all lines as one DB write
    const blob = lines.map(l => (typeof l === 'string' ? l : l.line ?? '')).join('\n') + '\n';
    await pool.query(
      `UPDATE builds
       SET logs       = CONCAT(COALESCE(logs, ''::text), $1::text),
           updated_at = NOW()
       WHERE id = $2::integer`,
      [blob, buildId],
    );

    // Fan out each line via Socket.IO
    const room = `build:${buildId}`;
    lines.forEach(({ line, stream = 'stdout', ts }) => {
      emitBuildLog(buildId, line ?? line, stream, ts ?? Date.now());
    });

    res.json({ ok: true, count: lines.length });
  } catch (err) {
    next(err);
  }
});

// ─── Internal helper (used by webhook.js) ────────────────────────────────────
// Called right after a build row is inserted so the dashboard list updates
// immediately when a job is queued — before the worker even starts.

async function notifyBuildQueued(build) {
  emitBuildQueued(build);
}

module.exports = router;
module.exports.notifyBuildQueued = notifyBuildQueued;