-- =============================================================================
-- Migration 001 — Auth & Multi-User Schema
-- Run once against your Neon / Supabase / local Postgres instance.
-- All statements are idempotent (safe to re-run).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. users
--    One row per GitHub identity. github_id is the stable OAuth subject.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                SERIAL        PRIMARY KEY,
  github_id         BIGINT        NOT NULL UNIQUE,          -- GitHub numeric user id
  github_login      VARCHAR(255)  NOT NULL,                 -- e.g. "abhinav"
  github_name       VARCHAR(255),                           -- display name (nullable)
  avatar_url        TEXT,
  github_token      TEXT          NOT NULL,                 -- OAuth access token (encrypted at rest — see notes)
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_login_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. sessions
--    Short-lived server-side sessions issued after OAuth callback.
--    Stored in Postgres so Render's stateless instances share state.
--    TTL enforced by the application (see auth.js) and by the cleanup job.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ   NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  user_agent  TEXT,
  ip_address  INET
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- 3. repositories
--    Repos connected by a user. One row per repo per user.
--    webhook_secret is generated per-repo so each hook can be verified
--    independently (GitHub HMAC-SHA256).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repositories (
  id              SERIAL        PRIMARY KEY,
  user_id         INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  github_repo_id  BIGINT        NOT NULL,                   -- GitHub repo numeric id
  full_name       VARCHAR(255)  NOT NULL,                   -- "owner/repo"
  clone_url       TEXT          NOT NULL,                   -- https clone URL
  default_branch  VARCHAR(255)  NOT NULL DEFAULT 'main',
  webhook_id      BIGINT,                                   -- GitHub webhook id (for deletion)
  webhook_secret  TEXT          NOT NULL,                   -- HMAC secret, per-repo
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, github_repo_id)
);

CREATE INDEX IF NOT EXISTS repositories_user_id_idx ON repositories(user_id);

-- ---------------------------------------------------------------------------
-- 4. builds  — extend the existing table
--    Add user_id and repository_id foreign keys.
--    The columns are added with IF NOT EXISTS so this is safe to run against
--    an existing Week 1-4 database.
-- ---------------------------------------------------------------------------
ALTER TABLE builds
  ADD COLUMN IF NOT EXISTS user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repository_id  INTEGER REFERENCES repositories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS builds_user_id_idx       ON builds(user_id);
CREATE INDEX IF NOT EXISTS builds_repository_id_idx ON builds(repository_id);
CREATE INDEX IF NOT EXISTS builds_created_at_idx    ON builds(created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. deployments
--    Tracks what image tag is live on k3s for each repo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deployments (
  id              SERIAL        PRIMARY KEY,
  build_id        INTEGER       NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  user_id         INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id   INTEGER       NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  image_tag       TEXT          NOT NULL,                   -- ghcr.io/owner/repo:sha
  k8s_namespace   VARCHAR(255)  NOT NULL,                   -- "user-<github_login>"
  k8s_deployment  VARCHAR(255)  NOT NULL,                   -- deployment name in k3s
  status          VARCHAR(50)   NOT NULL DEFAULT 'pending', -- pending | running | live | failed
  deployed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deployments_user_id_idx  ON deployments(user_id);
CREATE INDEX IF NOT EXISTS deployments_build_id_idx ON deployments(build_id);

-- ---------------------------------------------------------------------------
-- 6. Cleanup function — called by a cron job (or pg_cron if available)
--    Deletes expired sessions to keep the table small.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM sessions WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- =============================================================================
-- NOTES
-- github_token storage: for a portfolio project storing the raw token is
-- acceptable. For production, encrypt with pgcrypto:
--   UPDATE users SET github_token = pgp_sym_encrypt(token, $SECRET_KEY);
-- and decrypt on read:
--   pgp_sym_decrypt(github_token::bytea, $SECRET_KEY)
-- =============================================================================