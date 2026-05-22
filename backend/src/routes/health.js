/**
 * GET /health
 *
 * Liveness + readiness probe endpoint consumed by Kubernetes.
 * Returns 200 only when:
 *   - The Express process is alive
 *   - The PostgreSQL pool can execute a query
 *   - The RabbitMQ channel is open
 *
 * A partial failure returns 503 so K8s stops routing traffic to the pod.
 */

'use strict';

const express = require('express');
const { getPool } = require('../db');
const { getChannel } = require('../queue');

const router = express.Router();

router.get('/', async (_req, res) => {
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      postgres: 'unknown',
      rabbitmq: 'unknown',
    },
  };

  let httpStatus = 200;

  // ── PostgreSQL ─────────────────────────────────────────────────────────────
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    checks.checks.postgres = 'ok';
  } catch (err) {
    checks.checks.postgres = `error: ${err.message}`;
    checks.status = 'degraded';
    httpStatus = 503;
  }

  // ── RabbitMQ ───────────────────────────────────────────────────────────────
  try {
    const channel = getChannel();
    if (!channel) throw new Error('channel not initialised');
    checks.checks.rabbitmq = 'ok';
  } catch (err) {
    checks.checks.rabbitmq = `error: ${err.message}`;
    checks.status = 'degraded';
    httpStatus = 503;
  }

  return res.status(httpStatus).json(checks);
});

module.exports = router;
