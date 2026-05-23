-- =============================================================================
-- Migration 000 — Initial Schema (Week 1-4 tables)
-- Creates the builds table that 001_auth.sql depends on.
-- =============================================================================

CREATE TABLE IF NOT EXISTS builds (
  id            SERIAL        PRIMARY KEY,
  repository    VARCHAR(255)  NOT NULL,
  branch        VARCHAR(255)  NOT NULL,
  commit        VARCHAR(255)  NOT NULL,
  status        VARCHAR(50)   NOT NULL DEFAULT 'queued',
  logs          TEXT,
  worker_id     VARCHAR(255),
  started_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS builds_status_idx     ON builds(status);
CREATE INDEX IF NOT EXISTS builds_created_at_idx ON builds(created_at DESC);
