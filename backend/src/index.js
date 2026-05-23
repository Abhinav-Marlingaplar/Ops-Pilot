/**
 * backend/src/index.js  (Phase 2 — updated)
 *
 * Changes from Phase 1:
 *   1. Added /repos route (repository connection + webhook management)
 *   2. /webhook/github uses raw body parser for HMAC verification
 *      (must be registered BEFORE express.json() for that specific path)
 *   3. Added WEBHOOK_PUBLIC_URL to required env vars
 */

'use strict';

const http         = require('http');
const express      = require('express');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const dotenv       = require('dotenv');

dotenv.config();

// After
const REQUIRED_ENV = [
  'RABBITMQ_URL',
  'JWT_SECRET',
  'WORKER_JWT',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_CALLBACK_URL',
  'SESSION_COOKIE_SECRET',
  'FRONTEND_URL',
];

// Accept either DATABASE_URL (Neon/Render) or individual DB vars (local)
const hasDB = process.env.DATABASE_URL ||
  (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME);

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0 || !hasDB) {
  if (!hasDB) missing.push('DATABASE_URL (or DB_HOST + DB_USER + DB_PASSWORD + DB_NAME)');
  console.error('[startup] Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

// ─── Modules ─────────────────────────────────────────────────────────────────
const { connectDB }    = require('./db');
const { connectQueue } = require('./queue');
const { init: initSocket } = require('./socket');

const authRouter   = require('./routes/auth');
const reposRouter  = require('./routes/repositories');
const buildsRouter = require('./routes/builds');
const healthRouter = require('./routes/health');

// webhook router handles BOTH /webhook and /webhook/github
const webhookRouter = require('./routes/webhook');

const { requireAuth, requireUser, requireWorker } = require('./middleware/auth');

// ─── App ──────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

const IS_PROD      = process.env.NODE_ENV === 'production';
const PORT         = parseInt(process.env.PORT ?? '3000', 10);
const FRONTEND_URL = process.env.FRONTEND_URL;

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    const allowed = IS_PROD
      ? [FRONTEND_URL, 'https://ops-pilot-rho.vercel.app']
      : ['http://localhost:5173', 'http://localhost:3001'];
    if (!origin || allowed.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── IMPORTANT: raw body for /webhook/github MUST come before express.json() ──
// GitHub HMAC verification requires the raw Buffer, not the parsed object.
app.use('/webhook/github', express.raw({ type: 'application/json' }));

// ── Body + cookie parsing ─────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.SESSION_COOKIE_SECRET));
app.set('trust proxy', 1);

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health — no auth
app.use('/health', healthRouter);

// Auth — no auth guard (establishes auth)
app.use('/auth', authRouter);

// Repos — user only
app.use('/repos', requireUser, reposRouter);

// Webhook:
//   POST /webhook         → requireUser (manual trigger from dashboard)
//   POST /webhook/github  → no auth middleware (HMAC verified inside the route)
app.use('/webhook', webhookRouter);

// Builds:
//   GET  /builds, GET /builds/:id → requireAuth (user or worker)
//   POST /builds/status           → requireWorker
//   POST /builds/:id/logs         → requireWorker
app.use('/builds', (req, res, next) => {
  if (req.method === 'POST') return requireWorker(req, res, next);
  return requireAuth(req, res, next);
}, buildsRouter);

// ─── 404 + error handlers ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Cannot ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  try {
    await connectDB();
    console.log('[startup] PostgreSQL connected');

    await connectQueue();
    console.log('[startup] RabbitMQ connected');

    initSocket(server, [
      FRONTEND_URL,
      'http://localhost:5173',
    ]);
    console.log('[startup] Socket.IO initialised');

    server.listen(PORT, () => {
      console.log(`[startup] Server listening on port ${PORT}`);
      console.log(`[startup] Environment: ${process.env.NODE_ENV ?? 'development'}`);
    });
  } catch (err) {
    console.error('[startup] Fatal startup error:', err.message);
    process.exit(1);
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[shutdown] ${signal} — shutting down…`);
  server.close(async () => {
    try {
      const { getPool }    = require('./db');
      const { getChannel } = require('./queue');
      const ch = getChannel(); if (ch) await ch.close().catch(() => {});
      const pool = getPool(); if (pool) await pool.end().catch(() => {});
      process.exit(0);
    } catch { process.exit(1); }
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start();