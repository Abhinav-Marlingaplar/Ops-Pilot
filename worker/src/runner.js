/**
 * worker/src/runner.js  (Week 4 — updated)
 *
 * Changes from Week 2:
 *  1. All pipeline steps now stream stdout/stderr line-by-line via
 *     `reporter.streamLog()` as the child process produces output, rather than
 *     buffering everything and sending a single blob at the end.
 *
 *  2. `runPipeline()` now accepts the full `job` object (which contains
 *     `buildId` after the Week 4 webhook update) so the runner can pass
 *     `buildId` to `streamLog`.
 *
 *  3. A `running` status is reported immediately when the job starts so the
 *     dashboard shows the correct state before any logs arrive.
 *
 * HOW STREAMING WORKS
 *   Instead of `execSync` (blocking, buffers everything) we use `spawn` with
 *   stdio piped. We read stdout and stderr line-by-line using the readline
 *   module and call `streamLog` for each line. This means:
 *     - The browser terminal sees output as it happens
 *     - We still collect all lines into a `logs` buffer for the final
 *       `reportStatus` call (stored in the DB for later viewing)
 *     - Long-running commands (big npm install) don't look frozen
 */

'use strict';

const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const { spawn }  = require('child_process');
const readline   = require('readline');

const { streamLog, reportStatus } = require('./reporter');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run a shell command, streaming stdout/stderr line-by-line.
 *
 * @param {string}   cmd        Executable
 * @param {string[]} args       Arguments array (avoids shell injection)
 * @param {object}   options
 * @param {string}   options.cwd       Working directory
 * @param {number|string} options.buildId  For streamLog
 * @param {string[]} options.logBuffer   Collects all lines for the final report
 * @returns {Promise<{ exitCode: number, signal: string | null }>}
 */
function spawnStreaming(cmd, args, { cwd, buildId, logBuffer }) {
  return new Promise((resolve, reject) => {
    const label = `$ ${cmd} ${args.join(' ')}`;
    console.log(`[runner] ${label}`);

    // Echo the command itself to the live log
    const headerLine = `\x1b[36m${label}\x1b[0m`;  // cyan in terminal, stripped in plain log
    logBuffer.push(headerLine);
    // Fire-and-forget; we don't need to await the HTTP round-trip here
    streamLog(buildId, headerLine, 'stdout').catch(() => {});

    const child = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env,
        // Ensure npm / git don't prompt for credentials
        GIT_TERMINAL_PROMPT: '0',
        NPM_CONFIG_LOGLEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // ── stdout ────────────────────────────────────────────────────────────────
    const stdoutRL = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdoutRL.on('line', (line) => {
      logBuffer.push(line);
      streamLog(buildId, line, 'stdout').catch(() => {});
    });

    // ── stderr ────────────────────────────────────────────────────────────────
    const stderrRL = readline.createInterface({ input: child.stderr, crlfDelay: Infinity });
    stderrRL.on('line', (line) => {
      logBuffer.push(`[stderr] ${line}`);
      streamLog(buildId, line, 'stderr').catch(() => {});
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
 * Delete a directory tree, ignoring errors (cleanup is best-effort).
 *
 * @param {string} dir
 */
function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // intentionally swallowed — a leftover temp dir won't break anything
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run the full CI pipeline for a build job.
 *
 * Pipeline steps:
 *   1. Report status → 'running'  (so dashboard shows correct state immediately)
 *   2. git clone --depth=1
 *   3. git checkout <commit>      (if a specific commit SHA was given)
 *   4. npm install --prefer-offline
 *   5. npm test
 *   6. docker build               (only if Dockerfile present in repo root)
 *   7. Report final status + full log blob
 *   8. Cleanup temp dir
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
  const { buildId, repository, branch = 'main', commit = 'HEAD', workerId } = job;

  const logBuffer = [];
  const workDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-'));
  const repoDir   = path.join(workDir, 'repo');

  // Helper: append a marker line to both the buffer and the live stream
  async function logMarker(text) {
    logBuffer.push(text);
    await streamLog(buildId, text, 'stdout').catch(() => {});
    console.log(`[runner] ${text}`);
  }

  // ── 1. Signal "running" immediately ────────────────────────────────────────
  try {
    await reportStatus(job, { status: 'running', logs: '' });
  } catch {
    // non-fatal — continue even if the status update fails
  }

  await logMarker(`\x1b[1m=== CI Pipeline started ===\x1b[0m`);
  await logMarker(`Repository : ${repository}`);
  await logMarker(`Branch     : ${branch}`);
  await logMarker(`Commit     : ${commit}`);
  await logMarker(`Worker     : ${workerId ?? process.env.WORKER_ID ?? 'unknown'}`);
  await logMarker(`Work dir   : ${workDir}`);
  await logMarker('');

  try {
    // ── 2. Clone ──────────────────────────────────────────────────────────────
    await logMarker('── Step 1/5: Clone repository ──');
    const cloneResult = await spawnStreaming(
      'git',
      ['clone', '--depth=1', '--branch', branch, repository, repoDir],
      { cwd: workDir, buildId, logBuffer },
    );
    if (cloneResult.exitCode !== 0) {
      throw new Error(`git clone failed with exit code ${cloneResult.exitCode}`);
    }

    // ── 3. Checkout specific commit (if not HEAD) ─────────────────────────────
    if (commit && commit !== 'HEAD') {
      await logMarker(`── Step 2/5: Checkout commit ${commit} ──`);
      // Unshallow so we can access the specific commit
      await spawnStreaming('git', ['fetch', '--unshallow'], { cwd: repoDir, buildId, logBuffer });
      const checkoutResult = await spawnStreaming(
        'git', ['checkout', commit],
        { cwd: repoDir, buildId, logBuffer },
      );
      if (checkoutResult.exitCode !== 0) {
        throw new Error(`git checkout ${commit} failed with exit code ${checkoutResult.exitCode}`);
      }
    } else {
      await logMarker('── Step 2/5: Using HEAD (no specific commit) ──');
    }

    // ── 4. npm install ────────────────────────────────────────────────────────
    await logMarker('── Step 3/5: npm install ──');

    // Only run install if package.json exists (some repos may not be Node projects)
    const packageJsonPath = path.join(repoDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      await logMarker('[runner] No package.json found — skipping npm install');
    } else {
      const installResult = await spawnStreaming(
        'npm', ['install', '--prefer-offline'],
        { cwd: repoDir, buildId, logBuffer },
      );
      if (installResult.exitCode !== 0) {
        throw new Error(`npm install failed with exit code ${installResult.exitCode}`);
      }
    }

    // ── 5. npm test ───────────────────────────────────────────────────────────
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
        if (testResult.exitCode !== 0) {
          throw new Error(`npm test failed with exit code ${testResult.exitCode}`);
        }
      }
    }

    // ── 6. Docker build (optional) ────────────────────────────────────────────
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
      if (dockerResult.exitCode !== 0) {
        throw new Error(`docker build failed with exit code ${dockerResult.exitCode}`);
      }
      await logMarker(`[runner] Docker image built: ${imageTag}`);
    }

    // ── Success ───────────────────────────────────────────────────────────────
    await logMarker('');
    await logMarker('\x1b[32m=== Pipeline completed: SUCCESS ===\x1b[0m');

    const result = { status: 'success', logs: logBuffer.join('\n') };
    await reportStatus(job, result);
    return result;

  } catch (err) {
    // ── Failure ───────────────────────────────────────────────────────────────
    const errorLine = `\x1b[31m[runner] PIPELINE FAILED: ${err.message}\x1b[0m`;
    logBuffer.push(errorLine);
    await streamLog(buildId, errorLine, 'stderr').catch(() => {});
    console.error('[runner]', err.message);

    const result = { status: 'failed', logs: logBuffer.join('\n') };
    await reportStatus(job, result);
    return result;

  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────────
    cleanupDir(workDir);
    console.log(`[runner] Cleaned up work dir: ${workDir}`);
  }
}

module.exports = { runPipeline };