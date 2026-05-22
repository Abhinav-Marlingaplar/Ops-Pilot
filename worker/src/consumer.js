/**
 * worker/src/consumer.js  (Week 4 — updated)
 *
 * Change from Week 2:
 *   The job message now contains a `buildId` field (added by the webhook in
 *   Week 4). We pass the full job object through to `runPipeline` so the
 *   runner and reporter can use the id for targeted log streaming
 *   (`POST /builds/:id/logs`) instead of just the repo+branch+commit tuple.
 *
 * Everything else — retry logic, prefetch(1), ACK/NACK — is unchanged.
 */

'use strict';

const amqplib = require('amqplib');
const dotenv  = require('dotenv');

const { runPipeline } = require('./runner');

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? 'amqp://localhost';
const QUEUE_NAME   = 'build_jobs';
const MAX_ATTEMPTS = 10;
const RETRY_DELAY  = 3_000;   // ms between connection attempts

/**
 * Connect to RabbitMQ with exponential backoff, then start consuming.
 * The retry loop handles the case where RabbitMQ starts after the worker
 * (common in docker compose and cold Kubernetes deploys).
 */
async function startConsumer() {
  let connection = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`[consumer] Connecting to RabbitMQ (attempt ${attempt}/${MAX_ATTEMPTS})…`);
      connection = await amqplib.connect(RABBITMQ_URL);
      break;
    } catch (err) {
      console.warn(`[consumer] Connection failed: ${err.message}`);
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`[consumer] Could not connect to RabbitMQ after ${MAX_ATTEMPTS} attempts`);
      }
      await sleep(RETRY_DELAY);
    }
  }

  // Reconnect automatically if the connection drops unexpectedly.
  connection.on('error', (err) => {
    console.error('[consumer] RabbitMQ connection error:', err.message);
  });
  connection.on('close', () => {
    console.warn('[consumer] RabbitMQ connection closed — restarting in 5 s…');
    setTimeout(startConsumer, 5_000);
  });

  const channel = await connection.createChannel();

  // Durable queue — survives broker restart.
  await channel.assertQueue(QUEUE_NAME, { durable: true });

  // Process one job at a time so a single worker pod doesn't get overwhelmed.
  // The HPA will spin up more pods when the queue depth / CPU rises.
  channel.prefetch(1);

  console.log(`[consumer] Waiting for messages on queue: ${QUEUE_NAME}`);

  channel.consume(QUEUE_NAME, async (msg) => {
    if (!msg) return;   // consumer cancelled — nothing to do

    let job;
    try {
      job = JSON.parse(msg.content.toString());
    } catch (parseErr) {
      console.error('[consumer] Failed to parse job message — discarding:', parseErr.message);
      channel.nack(msg, false, false);   // dead-letter without requeue
      return;
    }

    // Inject WORKER_ID from env (set via the K8s Downward API in Week 3)
    job.workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;

    console.log('[consumer] Job received:', {
      buildId:    job.buildId,
      repository: job.repository,
      branch:     job.branch,
      commit:     job.commit,
      workerId:   job.workerId,
    });

    try {
      const result = await runPipeline(job);
      console.log(`[consumer] Pipeline finished: ${result.status}`);
      channel.ack(msg);
    } catch (pipelineErr) {
      // runPipeline should never throw (it handles its own errors internally),
      // but if it does we NACK without requeue so the job doesn't loop forever.
      console.error('[consumer] Unexpected pipeline error:', pipelineErr.message);
      channel.nack(msg, false, false);
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { startConsumer };