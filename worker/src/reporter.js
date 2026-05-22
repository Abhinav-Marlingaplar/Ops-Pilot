/**
 * worker/src/reporter.js  (Week 4 — updated)
 *
 * Changes from Week 2:
 *  1. `streamLog(buildId, line, stream)` — NEW.
 *     Called by runner.js for each line of stdout/stderr as it is produced.
 *     POSTs to `POST /builds/:id/logs` so the backend can fan it out via
 *     Socket.IO to any browser watching that build. This is what makes the
 *     live log terminal work.
 *
 *  2. `reportStatus(job, result)` — unchanged signature, but now uses the
 *     `buildId` field that the webhook queues in the job message (added in
 *     Week 4's webhook.js update). If buildId is present the status PATCH is
 *     more efficient (direct id lookup instead of repo+branch+commit scan).
 *
 * RETRY POLICY
 *   Both functions use a simple exponential-backoff retry (3 attempts) so a
 *   transient backend hiccup doesn't silently drop a log line or a status
 *   report. The worker still ACKs the RabbitMQ message after all retries are
 *   exhausted — we'd rather lose a status update than re-run an entire build.
 */

'use strict';

const axios  = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const BACKEND_URL  = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const WORKER_TOKEN = process.env.WORKER_JWT ?? process.env.JWT_SECRET ?? '';

// ─── Axios instance ───────────────────────────────────────────────────────────

const http = axios.create({
  baseURL: BACKEND_URL,
  timeout: 10_000,
  headers: {
    'Content-Type': 'application/json',
    // The worker authenticates to the backend with the same shared JWT secret.
    // In production this would be a dedicated service-account token.
    Authorization: `Bearer ${WORKER_TOKEN}`,
  },
});

// ─── Internal: exponential-backoff retry ─────────────────────────────────────

/**
 * Retry `fn` up to `maxAttempts` times with exponential backoff.
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
      const delay = 300 * 2 ** (attempt - 1);   // 300 ms, 600 ms, 1200 ms
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Stream a single log line to the backend.
 * The backend appends it to the DB and emits a `build:log` Socket.IO event.
 *
 * Called by runner.js for every line of stdout/stderr as it is produced —
 * not batched, so the browser terminal updates in near-real-time.
 *
 * Fire-and-forget from the caller's perspective: we await internally so the
 * worker can optionally await this, but failures are swallowed after retries
 * to avoid stalling the pipeline for a log-delivery hiccup.
 *
 * @param {number|string}      buildId  DB primary key of the build row
 * @param {string}             line     One line of text (no trailing newline needed)
 * @param {'stdout'|'stderr'}  stream
 */
async function streamLog(buildId, line, stream = 'stdout') {
  if (!buildId || !line) return;

  try {
    await withRetry(
      () => http.post(`/builds/${buildId}/logs`, { line, stream }),
      3,
      `streamLog(${buildId})`,
    );
  } catch (err) {
    // After 3 retries we give up — don't crash the worker over a missing log line.
    console.error(
      `[reporter] streamLog failed permanently for build ${buildId}:`,
      err.response?.data ?? err.message,
    );
  }
}

/**
 * Report the final build status to the backend.
 * Called once per build, at the very end of the pipeline.
 *
 * @param {object} job     The original job object from RabbitMQ
 * @param {object} result  { status: 'success'|'failed', logs: string, error?: string }
 */
async function reportStatus(job, result) {
  const { buildId, repository, branch, commit, workerId } = job;
  const { status, logs } = result;

  try {
    await withRetry(
      () =>
        http.post('/builds/status', {
          buildId:    buildId ?? undefined,   // undefined → backend falls back to repo lookup
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
    // Permanent failure after 3 retries — log it but don't crash the worker.
    console.error(
      `[reporter] reportStatus failed permanently for ${repository}@${commit ?? 'HEAD'}:`,
      err.response?.data ?? err.message,
    );
  }
}

module.exports = { streamLog, reportStatus };