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

// ─── Internal: exponential-backoff retry ─────────────────────────────────────

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
// Instead of one HTTP request per log line (1800+ requests per build),
// we buffer lines and send them in batches of 50.
// This reduces load on the Render backend dramatically.

const BATCH_SIZE     = 50;
const BATCH_INTERVAL = 200; // ms

const _queues = new Map(); // buildId → { lines: [], timer: null }

async function _flush(buildId) {
  const q = _queues.get(buildId);
  if (!q || q.lines.length === 0) return;
  const lines = q.lines.splice(0); // drain atomically
  try {
    await withRetry(
      () => http.post(`/builds/${buildId}/logs/batch`, { lines }),
      3,
      `batchLog(${buildId})`,
    );
  } catch (err) {
    console.error(`[reporter] batch log failed permanently for build ${buildId}:`, err.message);
  }
}

/**
 * Buffer a log line and send it to the backend in batches.
 * Replaces the old per-line streamLog approach.
 */
async function streamLog(buildId, line, stream = 'stdout') {
  if (!buildId || !line) return;

  if (!_queues.has(buildId)) {
    _queues.set(buildId, { lines: [], timer: null });
  }
  const q = _queues.get(buildId);
  q.lines.push({ line, stream, ts: Date.now() });

  // Flush immediately if batch is full
  if (q.lines.length >= BATCH_SIZE) {
    if (q.timer) { clearTimeout(q.timer); q.timer = null; }
    await _flush(buildId);
    return;
  }

  // Otherwise schedule a flush
  if (!q.timer) {
    q.timer = setTimeout(async () => {
      q.timer = null;
      await _flush(buildId);
    }, BATCH_INTERVAL);
  }
}

/**
 * Flush any remaining buffered lines for a build.
 * Call this at the end of the pipeline before reportStatus.
 */
async function flushLogs(buildId) {
  const q = _queues.get(buildId);
  if (q?.timer) { clearTimeout(q.timer); q.timer = null; }
  await _flush(buildId);
  _queues.delete(buildId);
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