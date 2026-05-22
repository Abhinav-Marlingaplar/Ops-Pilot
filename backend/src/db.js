/**
 * backend/src/db.js  (Phase 1 — updated)
 *
 * Changes from Week 1:
 *   1. Supports a single `DATABASE_URL` connection string (used by Neon,
 *      Supabase, and Render's managed Postgres) in addition to the individual
 *      DB_HOST / DB_PORT / … variables used locally.
 *   2. Adds SSL configuration required by Neon/Supabase (rejectUnauthorized
 *      is set to false for Neon's self-signed cert on the free tier).
 *   3. `connectDB` runs the latest migration SQL on first connect so the
 *      schema stays in sync automatically on deploy.
 *   4. Pool tuning for Render's free tier (max 5 connections) and Neon's
 *      serverless connection limits.
 */

'use strict';

const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');

let pool = null;

/**
 * Build the pg Pool config from environment variables.
 * Prefers DATABASE_URL if set, falls back to individual vars.
 */
function buildPoolConfig() {
  const IS_PROD = process.env.NODE_ENV === 'production';

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: IS_PROD ? { rejectUnauthorized: false } : false,
      max:              5,    // Render free tier + Neon free tier limit
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };
  }

  // Local / docker-compose fallback
  return {
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '5432', 10),
    user:     process.env.DB_USER     ?? 'cicd_user',
    password: process.env.DB_PASSWORD ?? 'cicd_pass',
    database: process.env.DB_NAME     ?? 'cicd_db',
    ssl:      false,
    max:      10,
    idleTimeoutMillis:       30_000,
    connectionTimeoutMillis: 10_000,
  };
}

/**
 * Connect to Postgres and run pending migrations.
 * Called once at server startup.
 */
async function connectDB() {
  pool = new Pool(buildPoolConfig());

  // Verify connectivity
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }

  // Run migrations
  await runMigrations();
}

/**
 * Run all migration files in /migrations in sorted order.
 * Uses a simple `schema_migrations` table to track what's already run.
 */
async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.log('[db] No migrations directory found — skipping');
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file],
    );

    if (rows.length > 0) continue; // already applied

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      console.log(`[db] Migration applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`[db] Migration failed (${file}): ${err.message}`);
    } finally {
      client.release();
    }
  }
}

/**
 * Returns the shared pool.
 * Throws if called before connectDB().
 *
 * @returns {Pool}
 */
function getPool() {
  if (!pool) {
    throw new Error('[db] Pool not initialised — call connectDB() first');
  }
  return pool;
}

module.exports = { connectDB, getPool };