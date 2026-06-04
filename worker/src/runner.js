'use strict';

/**
 * worker/src/runner.js
 *
 * Executes the full CI pipeline for a single build job:
 *   1. Report status → 'running'   (dashboard updates immediately)
 *   2. git clone --depth=1
 *   3. git checkout <commit>        (only when a specific SHA is supplied)
 *   4. npm install --prefer-offline
 *   5. npm test
 *   6. docker build                 (only when Dockerfile exists)
 *   7. flushLogs + reportStatus     (final status + full log blob)
 *   8. Cleanup temp dir
 *
 * ── Streaming strategy ───────────────────────────────────────────────────────
 * Each pipeline step uses `spawn` + `readline` instead of `execSync` so that
 * stdout/stderr lines are forwarded to the frontend terminal as they are
 * produced — not after the process exits.
 *
 * `await flushLogs(buildId)` is called after EVERY step so that lines from one
 * step are guaranteed to appear on the dashboard before the next step's header
 * is written. Without this, the 100-150ms batch timer can fire in the middle of
 * a step transition, making the terminal look scrambled.
 *
 * ── Why flushLogs after each step matters ────────────────────────────────────
 * `npm install` can produce 1800+ lines in <200ms on a warm cache. The batch
 * timer fires every 150ms, but if the readline event loop is saturated the
 * timer callback is deferred. Awaiting flushLogs() after spawnStreaming()
 * returns guarantees every line has been delivered before we move on.
 */

'use strict';

const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { spawn } = require('child_process');
const readline  = require('readline');

const { streamLog, flushLogs, reportStatus } = require('./reporter');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run a shell command, streaming stdout/stderr line-by-line to the log queue.
 *
 * @param {string}   cmd
 * @param {string[]} args        Argument array — no shell expansion, no injection
 * @param {object}   opts
 * @param {string}   opts.cwd
 * @param {number|string} opts.buildId
 * @param {string[]} opts.logBuffer   All lines collected here for the final blob
 * @param {object}   [opts.env]       Extra environment variables to merge
 * @returns {Promise<{ exitCode: number, signal: string | null }>}
 */
function spawnStreaming(cmd, args, { cwd, buildId, logBuffer, env = {} }) {
  return new Promise((resolve, reject) => {
    const label      = `$ ${cmd} ${args.join(' ')}`;
    const headerLine = `\x1b[36m${label}\x1b[0m`; // cyan in terminal

    console.log(`[runner] ${label}`);
    logBuffer.push(headerLine);
    streamLog(buildId, headerLine, 'stdout');

    const child = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env,
        // Prevent interactive prompts that would hang the worker
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS:         'echo',
        NPM_CONFIG_LOGLEVEL: 'error',
        CI:                  'true',      // many test frameworks quieten under CI=true
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutRL = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdoutRL.on('line', (line) => {
      logBuffer.push(line);
      streamLog(buildId, line, 'stdout');
    });

    const stderrRL = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
    stderrRL.on('line', (line) => {
      const tagged = `[stderr] ${line}`;
      logBuffer.push(tagged);
      streamLog(buildId, line, 'stderr');
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn \`${cmd}\`: ${err.message}`));
    });

    child.on('close', (exitCode, signal) => {
      resolve({ exitCode: exitCode ?? 1, signal });
    });
  });
}

/**
 * Best-effort recursive directory removal. Never throws — a leftover temp dir
 * does not warrant failing the pipeline.
 *
 * @param {string} dir
 */
function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // intentionally swallowed
  }
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Run the full CI pipeline for a build job.
 *
 * @param {object} job
 * @param {number|string} job.buildId
 * @param {string}        job.repository
 * @param {string}        job.branch
 * @param {string}        job.commit
 * @param {string}        [job.workerId]
 * @returns {Promise<{ status: 'success' | 'failed', logs: string }>}
 */
async function runPipeline(job) {
  const {
    buildId,
    repository,
    branch   = 'main',
    commit   = 'HEAD',
    workerId = process.env.WORKER_ID ?? 'worker-unknown',
  } = job;

  const logBuffer = [];
  const workDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-'));
  const repoDir   = path.join(workDir, 'repo');

  /**
   * Write a marker line to the log buffer and live stream, then await a flush
   * so it appears on the dashboard before the next output arrives.
   */
  async function logMarker(text) {
    logBuffer.push(text);
    streamLog(buildId, text, 'stdout');
    console.log(`[runner] ${text}`);
    // Flush immediately so section headers appear in order on the dashboard
    await flushLogs(buildId);
  }

  // ── 1. Report "running" immediately ─────────────────────────────────────────
  try {
    await reportStatus(job, { status: 'running', logs: '' });
  } catch {
    // Non-fatal — the pipeline continues even if this status update drops
  }

  await logMarker('\x1b[1m=== CI Pipeline started ===\x1b[0m');
  await logMarker(`Repository : ${repository}`);
  await logMarker(`Branch     : ${branch}`);
  await logMarker(`Commit     : ${commit}`);
  await logMarker(`Worker     : ${workerId}`);
  await logMarker(`Work dir   : ${workDir}`);
  await logMarker('');

  try {

    // ── 2. Clone ───────────────────────────────────────────────────────────────
    await logMarker('── Step 1/5: Clone repository ──');
    const cloneResult = await spawnStreaming(
      'git',
      ['clone', '--depth=1', '--branch', branch, repository, repoDir],
      { cwd: workDir, buildId, logBuffer },
    );
    // Flush after clone so all git progress lines are visible before Step 2
    await flushLogs(buildId);
    if (cloneResult.exitCode !== 0) {
      throw new Error(`git clone failed with exit code ${cloneResult.exitCode}`);
    }

    // ── 3. Checkout specific commit (if not HEAD) ──────────────────────────────
    if (commit && commit !== 'HEAD') {
      await logMarker(`── Step 2/5: Checkout commit ${commit} ──`);
      // depth=1 clone doesn't have the full history; unshallow first
      await spawnStreaming('git', ['fetch', '--unshallow'], { cwd: repoDir, buildId, logBuffer });
      const checkoutResult = await spawnStreaming(
        'git', ['checkout', commit],
        { cwd: repoDir, buildId, logBuffer },
      );
      await flushLogs(buildId);
      if (checkoutResult.exitCode !== 0) {
        throw new Error(`git checkout ${commit} failed with exit code ${checkoutResult.exitCode}`);
      }
    } else {
      await logMarker('── Step 2/5: Using HEAD (no specific commit) ──');
    }

    // ── 4. npm install ─────────────────────────────────────────────────────────
    await logMarker('── Step 3/5: npm install ──');
    const packageJsonPath = path.join(repoDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      await logMarker('[runner] No package.json found — skipping npm install');
    } else {
      const installResult = await spawnStreaming(
        'npm', ['install', '--prefer-offline'],
        { cwd: repoDir, buildId, logBuffer },
      );
      // *** Critical flush — npm install produces the most lines ***
      // Await this before writing the Step 4 header so the install output
      // is fully visible on the dashboard before the test section appears.
      await flushLogs(buildId);
      if (installResult.exitCode !== 0) {
        throw new Error(`npm install failed with exit code ${installResult.exitCode}`);
      }
    }

    // ── 5. npm test ────────────────────────────────────────────────────────────
    await logMarker('── Step 4/5: npm test ──');
    if (!fs.existsSync(packageJsonPath)) {
      await logMarker('[runner] No package.json — skipping npm test');
    } else {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (!pkg?.scripts?.test) {
        await logMarker('[runner] No test script defined in package.json — marking as success');
      } else {
        const testResult = await spawnStreaming(
          'npm', ['test', '--', '--forceExit'],
          { cwd: repoDir, buildId, logBuffer },
        );
        await flushLogs(buildId);
        if (testResult.exitCode !== 0) {
          throw new Error(`npm test failed with exit code ${testResult.exitCode}`);
        }
      }
    }

    // ── 6. Docker build (optional) ─────────────────────────────────────────────
    await logMarker('── Step 5/5: Docker build ──');
    const dockerfilePath = path.join(repoDir, 'Dockerfile');
    if (!fs.existsSync(dockerfilePath)) {
      await logMarker('[runner] No Dockerfile found — skipping docker build');
    } else {
      const imageTag = `cicd-build-${buildId ?? 'local'}:${(commit ?? 'HEAD').slice(0, 7)}`;
      const dockerResult = await spawnStreaming(
        'docker', ['build', '-t', imageTag, '.'],
        { cwd: repoDir, buildId, logBuffer },
      );
      await flushLogs(buildId);
      if (dockerResult.exitCode !== 0) {
        throw new Error(`docker build failed with exit code ${dockerResult.exitCode}`);
      }
      await logMarker(`[runner] Docker image built: ${imageTag}`);
    }

    // ── Success ────────────────────────────────────────────────────────────────
    await logMarker('');
    await logMarker('\x1b[32m=== Pipeline completed: SUCCESS ===\x1b[0m');

    // Final flush — ensures the SUCCESS line is visible before the status
    // update closes the Socket.IO room on the dashboard
    await flushLogs(buildId);

    const result = { status: 'success', logs: logBuffer.join('\n') };
    await reportStatus(job, result);
    return result;

  } catch (err) {
    // ── Failure ────────────────────────────────────────────────────────────────
    const errorLine = `\x1b[31m[runner] PIPELINE FAILED: ${err.message}\x1b[0m`;
    logBuffer.push(errorLine);
    streamLog(buildId, errorLine, 'stderr');
    console.error('[runner] PIPELINE FAILED:', err.message);

    await flushLogs(buildId);

    const result = { status: 'failed', logs: logBuffer.join('\n') };
    await reportStatus(job, result);
    return result;

  } finally {
    // ── Cleanup ────────────────────────────────────────────────────────────────
    cleanupDir(workDir);
    console.log(`[runner] Cleaned up work dir: ${workDir}`);
  }
}

module.exports = { runPipeline };