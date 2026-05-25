'use strict';

const axios  = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const BACKEND_URL  = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const WORKER_TOKEN = process.env.WORKER_JWT ?? process.env.JWT_SECRET ?? '';

// ─── Axios instance ───────────────────────────────────────────────────────────

const http = axios.create({
  baseURL: BACKEND_URL,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${WORKER_TOKEN}`,
  },
});

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry(fn, maxAttempts = 3, label = 'request') {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = 300 * 2 ** (attempt - 1);
      const status = err.response?.status;
      console.warn(
        `[reporter] ${label} attempt ${attempt}/${maxAttempts} failed` +
        (status ? ` (HTTP ${status})` : '') +
        ` — retrying in ${delay} ms`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Batch log queue ──────────────────────────────────────────────────────────
//
// Strategy: accumulate lines and flush every BATCH_INTERVAL ms OR when
// BATCH_SIZE lines have accumulated — whichever comes first.
//
// This gives near-real-time streaming (50ms delay max) while keeping
// HTTP requests to ~1 per 50 lines instead of 1 per line.

const BATCH_SIZE     = 30;   // flush when this many lines accumulate
const BATCH_INTERVAL = 100;  // flush every 100ms regardless of size

const _queues = new Map(); // buildId → { lines: [], timer: null, flushing: false }

async function _flush(buildId) {
  const q = _queues.get(buildId);
  if (!q || q.lines.length === 0 || q.flushing) return;

  q.flushing = true;
  const lines = q.lines.splice(0); // drain atomically
  q.flushing = false;

  try {
    await withRetry(
      () => http.post(`/builds/${buildId}/logs/batch`, { lines }),
      3,
      `batchLog(${buildId})`,
    );
  } catch (err) {
    console.error(`[reporter] batch log failed for build ${buildId}:`, err.message);
  }
}

/**
 * Queue a log line for batched delivery to the backend.
 * Flushes every 100ms or every 30 lines — whichever comes first.
 * This keeps the live terminal near-real-time without flooding the backend.
 */
function streamLog(buildId, line, stream = 'stdout') {
  if (!buildId || !line) return;

  if (!_queues.has(buildId)) {
    _queues.set(buildId, { lines: [], timer: null, flushing: false });
  }
  const q = _queues.get(buildId);
  q.lines.push({ line, stream, ts: Date.now() });

  // Flush immediately if batch is full — synchronously schedule
  if (q.lines.length >= BATCH_SIZE) {
    if (q.timer) { clearTimeout(q.timer); q.timer = null; }
    // Use setImmediate to avoid blocking the readline event loop
    setImmediate(() => _flush(buildId));
    return;
  }

  // Schedule a flush if one isn't already pending
  if (!q.timer) {
    q.timer = setTimeout(() => {
      q.timer = null;
      _flush(buildId);
    }, BATCH_INTERVAL);
  }
}

/**
 * Flush all remaining buffered lines for a build.
 * Call this at the end of the pipeline, BEFORE reportStatus.
 * Waits for the flush to complete so no lines are lost.
 */
async function flushLogs(buildId) {
  const q = _queues.get(buildId);
  if (!q) return;

  // Cancel the pending timer
  if (q.timer) { clearTimeout(q.timer); q.timer = null; }

  // Wait for any in-progress flush to complete, then flush remaining
  await sleep(50); // let any setImmediate flushes complete
  await _flush(buildId);

  _queues.delete(buildId);
  console.log(`[reporter] Logs flushed for build ${buildId}`);
}

// ─── Status reporting ─────────────────────────────────────────────────────────

async function reportStatus(job, result) {
  const { buildId, repository, branch, commit, workerId } = job;
  const { status, logs } = result;

  try {
    await withRetry(
      () => http.post('/builds/status', {
        buildId:  buildId ?? undefined,
        repository,
        branch,
        commit,
        status,
        logs,
        workerId: workerId ?? process.env.WORKER_ID ?? 'worker-unknown',
      }),
      3,
      `reportStatus(${buildId ?? repository})`,
    );

    console.log(`[reporter] Status reported: ${status} for ${repository}@${commit ?? 'HEAD'}`);
  } catch (err) {
    console.error(
      `[reporter] reportStatus failed permanently for ${repository}@${commit ?? 'HEAD'}:`,
      err.response?.data ?? err.message,
    );
  }
}

module.exports = { streamLog, flushLogs, reportStatus };