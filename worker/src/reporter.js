'use strict';

/**
 * worker/src/reporter.js
 *
 * Responsible for two things:
 *   1. Streaming log lines to the backend in batches (near-real-time terminal)
 *   2. Reporting final build status (success / failed / running)
 *
 * ── Batch flushing design ────────────────────────────────────────────────────
 *
 * Lines are queued and sent in batches to keep HTTP overhead low while still
 * giving the frontend a near-real-time terminal experience.
 *
 * Flush is triggered by whichever comes first:
 *   • BATCH_SIZE lines accumulated (default 30)
 *   • BATCH_INTERVAL ms elapsed    (default 150ms)
 *
 * Critical correctness properties:
 *   • `_flushPromise` serialises flushes — a new flush never starts while one
 *     is in-flight. Lines that arrive during a flush are queued and picked up
 *     by the next flush cycle.
 *   • `flushLogs()` drains the queue completely (multiple passes if needed)
 *     before returning, so no lines are lost at pipeline end.
 *   • `streamLog()` is synchronous — it only enqueues and schedules; it never
 *     awaits anything, so it cannot block the readline event loop.
 */

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
    Authorization:  `Bearer ${WORKER_TOKEN}`,
  },
});

// ─── Retry helper ─────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff.
 *
 * @param {() => Promise<any>} fn
 * @param {number}             maxAttempts
 * @param {string}             label        For log messages
 */
async function withRetry(fn, maxAttempts = 3, label = 'request') {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay  = 300 * 2 ** (attempt - 1); // 300 → 600 → 1200ms
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

// ─── Per-build queue state ────────────────────────────────────────────────────

/**
 * @typedef {{ line: string, stream: 'stdout' | 'stderr', ts: number }} LogEntry
 *
 * @typedef {{
 *   lines:         LogEntry[],   // pending lines not yet sent
 *   timer:         ReturnType<typeof setTimeout> | null,
 *   flushPromise:  Promise<void> | null,  // null when idle
 * }} BuildQueue
 */

const BATCH_SIZE     = 30;   // send when this many lines have queued up
const BATCH_INTERVAL = 150;  // send every Nms even if batch isn't full

/** @type {Map<string|number, BuildQueue>} */
const _queues = new Map();

function _getOrCreate(buildId) {
  if (!_queues.has(buildId)) {
    _queues.set(buildId, { lines: [], timer: null, flushPromise: null });
  }
  return _queues.get(buildId);
}

/**
 * Perform one flush cycle for a build:
 *   • Drains all currently-queued lines into a single POST
 *   • Serialised via `flushPromise` — concurrent calls chain rather than race
 *
 * @param {string|number} buildId
 * @returns {Promise<void>}
 */
function _flush(buildId) {
  const q = _getOrCreate(buildId);

  // Chain onto any in-progress flush so we never have two concurrent POSTs
  // for the same build.
  q.flushPromise = (q.flushPromise ?? Promise.resolve()).then(async () => {
    if (q.lines.length === 0) return;

    // Drain atomically — lines added after this point go into the next batch
    const batch = q.lines.splice(0);

    try {
      await withRetry(
        () => http.post(`/builds/${buildId}/logs/batch`, { lines: batch }),
        3,
        `batchLog(${buildId})`,
      );
    } catch (err) {
      // If all retries fail, log and continue — a dropped batch is preferable
      // to crashing the worker or blocking the pipeline.
      console.error(
        `[reporter] batch log permanently failed for build ${buildId}: ${err.message}`,
      );
    }
  });

  return q.flushPromise;
}

// ─── Public streaming API ─────────────────────────────────────────────────────

/**
 * Queue a log line for batched delivery to the backend.
 *
 * This function is intentionally synchronous (no await). It enqueues and
 * schedules — it never blocks the readline event loop. Actual I/O happens
 * asynchronously via the timer or size threshold.
 *
 * @param {string|number}      buildId
 * @param {string}             line
 * @param {'stdout'|'stderr'}  [stream]
 */
function streamLog(buildId, line, stream = 'stdout') {
  if (!buildId || line == null) return;

  const q = _getOrCreate(buildId);
  q.lines.push({ line, stream, ts: Date.now() });

  if (q.lines.length >= BATCH_SIZE) {
    // Batch is full — flush immediately and cancel the pending timer
    if (q.timer !== null) {
      clearTimeout(q.timer);
      q.timer = null;
    }
    // Schedule via setImmediate so the current readline 'line' event handler
    // returns first. This prevents a microtask storm that would starve the
    // readline interface on high-output commands like `npm install`.
    setImmediate(() => _flush(buildId));
    return;
  }

  // Schedule a timed flush if one isn't already pending
  if (q.timer === null) {
    q.timer = setTimeout(() => {
      q.timer = null;
      _flush(buildId);
    }, BATCH_INTERVAL);
  }
}

/**
 * Flush all remaining buffered lines for a build and wait for completion.
 *
 * Call this at the end of each major pipeline step AND at pipeline end,
 * BEFORE `reportStatus`. Waiting here ensures no lines are silently dropped
 * between the last log line and the status update.
 *
 * Drains in multiple passes because lines can be added to the queue while a
 * flush POST is in-flight (e.g. the 'close' event fires during the await).
 *
 * @param {string|number} buildId
 */
async function flushLogs(buildId) {
  const q = _queues.get(buildId);
  if (!q) return;

  // Cancel any pending timer — we'll flush manually right now
  if (q.timer !== null) {
    clearTimeout(q.timer);
    q.timer = null;
  }

  // Drain loop: keep flushing until both the queue and in-flight promise are
  // empty. This handles the case where lines arrive during the HTTP POST.
  for (let pass = 0; pass < 10; pass++) {
    if (q.lines.length > 0) {
      _flush(buildId);
    }
    // Wait for all in-flight batches to settle
    if (q.flushPromise) {
      await q.flushPromise;
    }
    // If queue is now empty we're done
    if (q.lines.length === 0) break;
  }

  _queues.delete(buildId);
  console.log(`[reporter] Logs flushed for build ${buildId}`);
}

// ─── Status reporting ─────────────────────────────────────────────────────────

/**
 * Report the final (or intermediate) build status to the backend.
 *
 * @param {object} job
 * @param {number|string} job.buildId
 * @param {string}        job.repository
 * @param {string}        job.branch
 * @param {string}        job.commit
 * @param {string}        [job.workerId]
 * @param {{ status: string, logs: string }} result
 */
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
      `[reporter] reportStatus permanently failed for ${repository}@${commit ?? 'HEAD'}:`,
      err.response?.data ?? err.message,
    );
  }
}

module.exports = { streamLog, flushLogs, reportStatus };