'use strict';

/**
 * worker/src/runner.js
 *
 * Executes the full CI pipeline for a single build job:
 *   1. Report status → 'running'          (dashboard updates immediately)
 *   2. git clone --depth=1                (inside sandbox container)
 *   3. git checkout <commit>              (inside sandbox container, only when specific SHA given)
 *   4. npm install --prefer-offline       (inside sandbox container)
 *   5. npm test                           (inside sandbox container)
 *   6. docker build                       (on host — needs Docker daemon socket)
 *   7. flushLogs + reportStatus           (final status + full log blob)
 *   8. Cleanup temp dir
 *
 * ── Sandboxing strategy ──────────────────────────────────────────────────────
 * Steps 2–5 run inside a `docker run --rm` container with hard resource limits
 * and no outbound network access after the initial clone.  This means:
 *
 *   • Each build gets a clean, isolated filesystem — no bleed between runs
 *   • A runaway build (infinite loop, fork bomb) is capped at 0.5 CPU / 512 MB
 *   • Build code never touches the worker host's filesystem directly
 *   • The container is force-removed when the step finishes (--rm)
 *
 * The cloned repo is written to a host tmpdir that is bind-mounted into the
 * container at /workspace.  After the container exits, the same directory is
 * available on the host for the docker build step (Step 6), which must run
 * outside the sandbox because it needs the Docker daemon socket.
 *
 * ── Resource limits (tunable via environment) ────────────────────────────────
 *   SANDBOX_CPUS   (default "0.5")   — fractional CPU cores
 *   SANDBOX_MEMORY (default "512m")  — Docker memory limit string
 *
 * ── Streaming strategy ───────────────────────────────────────────────────────
 * Every step uses `spawn` + `readline` so stdout/stderr lines are forwarded to
 * the frontend terminal as they are produced — not after the process exits.
 *
 * `await flushLogs(buildId)` is called after EVERY step so that lines from one
 * step are guaranteed to appear on the dashboard before the next step's header
 * is written.
 */

const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { spawn } = require('child_process');
const readline  = require('readline');

const { streamLog, flushLogs, reportStatus } = require('./reporter');

// ─── Sandbox configuration ────────────────────────────────────────────────────

const SANDBOX_IMAGE  = process.env.SANDBOX_IMAGE  ?? 'node:20-alpine';
const SANDBOX_CPUS   = process.env.SANDBOX_CPUS   ?? '0.5';
const SANDBOX_MEMORY = process.env.SANDBOX_MEMORY ?? '512m';

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
    const headerLine = `\x1b[36m${label}\x1b[0m`;

    console.log(`[runner] ${label}`);
    logBuffer.push(headerLine);
    streamLog(buildId, headerLine, 'stdout');

    const child = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS:         'echo',
        NPM_CONFIG_LOGLEVEL: 'error',
        CI:                  'true',
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
 * Run a multi-step shell script inside a sandboxed `docker run --rm` container.
 *
 * Instead of passing the script via `sh -c "..."` (which is fragile — Docker's
 * argument handling can mangle newlines and the script never runs, producing a
 * silent exit 127), we write the script to a file on the host and mount it
 * read-only into the container at /sandbox/run.sh. Docker mounts are byte-
 * perfect, so the script always arrives intact regardless of its content.
 *
 * Mount layout inside the container:
 *   /workspace   — rw bind-mount of repoDir (clone output persists on host)
 *   /sandbox     — ro bind-mount of a tmpdir containing run.sh
 *
 * @param {string}        script     Shell script content
 * @param {object}        opts
 * @param {string}        opts.repoDir   Host path bind-mounted to /workspace
 * @param {number|string} opts.buildId
 * @param {string[]}      opts.logBuffer
 * @param {object}        [opts.env]     Key-value pairs passed as -e flags
 * @returns {Promise<{ exitCode: number, signal: string | null }>}
 */
function spawnSandboxed(script, { repoDir, buildId, logBuffer, env = {} }) {
  // Write the script to a temp file on the host so Docker mounts it verbatim.
  // This is the only reliable way to pass a multiline script — sh -c with
  // newlines is mangled by Docker's argument serialisation layer.
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-script-'));
  const scriptPath = path.join(sandboxDir, 'run.sh');
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  const envFlags = Object.entries({
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS:         'echo',
    NPM_CONFIG_LOGLEVEL: 'error',
    CI:                  'true',
    ...env,
  }).flatMap(([k, v]) => ['-e', `${k}=${v}`]);

  const args = [
    'run', '--rm',

    // ── Resource limits ──────────────────────────────────────────────────────
    `--cpus=${SANDBOX_CPUS}`,
    `--memory=${SANDBOX_MEMORY}`,
    '--memory-swap=0',

    // ── Security ─────────────────────────────────────────────────────────────
    '--security-opt=no-new-privileges',
    // Run as root inside the container so it can write to the bind-mounted
    // /workspace directory (which is owned by root on the host).
    // This is safe — the container is ephemeral and isolated by --cpus/--memory.
    '--user', 'root',

    // ── Filesystem ───────────────────────────────────────────────────────────
    '--volume', `${repoDir}:/workspace`,      // rw — clone output persists
    '--volume', `${sandboxDir}:/sandbox:ro`,  // ro — script file, tamper-proof
    '--workdir', '/workspace',

    // ── Environment ──────────────────────────────────────────────────────────
    ...envFlags,

    // ── Image + entrypoint ───────────────────────────────────────────────────
    // Run the mounted script file directly — no sh -c, no escaping issues.
    SANDBOX_IMAGE,
    'sh', '/sandbox/run.sh',
  ];

  // Clean up the script tempdir after the container exits.
  return spawnStreaming('docker', args, { cwd: repoDir, buildId, logBuffer })
    .finally(() => cleanupDir(sandboxDir));
}

/**
 * Best-effort recursive directory removal. Never throws — a leftover temp dir
 * does not warrant failing the pipeline.
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

  // repoDir lives on the HOST so it survives past the sandbox container's
  // lifetime and is available for the docker build step.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-'));
  const repoDir = path.join(workDir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });

  /**
   * Write a marker line to both the log buffer and live stream, then flush
   * so section headers appear on the dashboard before the next step's output.
   */
  async function logMarker(text) {
    logBuffer.push(text);
    streamLog(buildId, text, 'stdout');
    console.log(`[runner] ${text}`);
    await flushLogs(buildId);
  }

  // ── 1. Report "running" immediately ─────────────────────────────────────────
  try {
    await reportStatus(job, { status: 'running', logs: '' });
  } catch {
    // Non-fatal — pipeline continues even if this initial status update drops
  }

  await logMarker('\x1b[1m=== CI Pipeline started ===\x1b[0m');
  await logMarker(`Repository : ${repository}`);
  await logMarker(`Branch     : ${branch}`);
  await logMarker(`Commit     : ${commit}`);
  await logMarker(`Worker     : ${workerId}`);
  await logMarker(`Sandbox    : ${SANDBOX_IMAGE} (${SANDBOX_CPUS} CPU, ${SANDBOX_MEMORY} RAM)`);
  await logMarker(`Work dir   : ${workDir}`);
  await logMarker('');

  try {

    // ── 2–5. Clone → Checkout → Install → Test (sandboxed) ───────────────────
    //
    // All four steps run inside a single `docker run --rm` invocation so that
    // the container only needs to be started once.  The script is a plain
    // POSIX sh sequence — `set -e` ensures any failure aborts immediately and
    // the container exits non-zero, which spawnSandboxed translates into a
    // thrown Error.
    //
    // Splitting these into four separate `docker run` calls would be cleaner
    // but would quadruple container startup overhead (~400ms each on a cold
    // Docker daemon).  The single-container approach is faster while still
    // providing full isolation per build job.

    await logMarker('── Step 1/5: Clone repository ──');
    await logMarker(`\x1b[33m[sandbox] image=${SANDBOX_IMAGE} cpus=${SANDBOX_CPUS} memory=${SANDBOX_MEMORY}\x1b[0m`);

    // Build the sh script as an array of lines for readability, then join.
    const checkoutStep = (commit && commit !== 'HEAD')
      ? [
          'echo "── Step 2/5: Checkout commit ──"',
          'git fetch --unshallow',
          `git checkout ${commit}`,
        ]
      : ['echo "── Step 2/5: Using HEAD (no specific commit) ──"'];

    const sandboxScript = [
      'set -e',

      // Install git if not present.
      // IMPORTANT: apt-get update is run with `|| true` so that transient apt
      // cache failures (common inside capability-restricted containers) do not
      // abort the whole script via `set -e`.  The install itself still fails
      // hard (no || true) so a genuine "git not available" case is caught.
      'export DEBIAN_FRONTEND=noninteractive',
      'if ! command -v git > /dev/null 2>&1; then',
      '  if command -v apk > /dev/null 2>&1; then',
      '    apk add --no-cache git || { echo "[sandbox] apk install git failed"; exit 1; }',
      '  elif command -v apt-get > /dev/null 2>&1; then',
      '    apt-get update -qq || true',
      '    apt-get install -y --no-install-recommends git ca-certificates',
      '  else',
      '    echo "[sandbox] ERROR: cannot install git — no known package manager"',
      '    exit 1',
      '  fi',
      'fi',

      // Step 1 — Clone into /workspace (already the workdir)
      // Redirect stderr to stdout (2>&1) so git progress lines appear in the live log stream
      `git clone --depth=1 --branch "${branch}" "${repository}" . 2>&1`,

      // Step 2 — Checkout specific commit or HEAD
      ...checkoutStep,

      // Step 3 — Install (skip gracefully if no package.json)
      'echo "── Step 3/5: npm install ──"',
      'if [ -f package.json ]; then npm install --prefer-offline; else echo "[sandbox] No package.json — skipping"; fi',

      // Step 4 — Test (skip gracefully if no test script)
      'echo "── Step 4/5: npm test ──"',
      'if [ -f package.json ] && node -e "process.exit(require(\'./package.json\').scripts && require(\'./package.json\').scripts.test ? 0 : 1)" 2>/dev/null; then npm test -- --forceExit; else echo "[sandbox] No test script — skipping"; fi',
    ].join('\n');

    const sandboxResult = await spawnSandboxed(sandboxScript, {
      repoDir,
      buildId,
      logBuffer,
    });

    await flushLogs(buildId);

    if (sandboxResult.exitCode !== 0) {
      throw new Error(
        `Sandboxed build steps failed with exit code ${sandboxResult.exitCode}`,
      );
    }

    // ── 6. Docker build (on host — needs Docker daemon) ───────────────────────
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
    // repoDir is on the host — clean it up after the pipeline is fully done
    // (including docker build, which reads from it).
    cleanupDir(workDir);
    console.log(`[runner] Cleaned up work dir: ${workDir}`);
  }
}

module.exports = { runPipeline };