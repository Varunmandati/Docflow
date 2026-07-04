-- =============================================================
-- DocFlow Database Schema — Migration 001
-- Run with: docflow_admin role only
-- =============================================================

BEGIN;

-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- Extension for case-insensitive text (email)
CREATE EXTENSION IF NOT EXISTS "citext";

-- === ROLE CREATION ===
-- Run as superuser/admin during initial setup only. Avoid errors if roles already exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'docflow_api') THEN
    CREATE ROLE docflow_api WITH LOGIN PASSWORD 'skillforge_api_pass';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'docflow_worker') THEN
    CREATE ROLE docflow_worker WITH LOGIN PASSWORD 'skillforge_worker_pass';
  END IF;
END
$$;

-- Restrict connection to docflow database only
GRANT CONNECT ON DATABASE docflow TO docflow_api;
GRANT CONNECT ON DATABASE docflow TO docflow_worker;

-- Revoke public schema defaults
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO docflow_api;
GRANT USAGE ON SCHEMA public TO docflow_worker;

-- =============================================================
-- TABLE: users
-- Central identity table. One row per authenticated user.
-- =============================================================
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             CITEXT NOT NULL UNIQUE,        -- citext = case-insensitive, no lowercasing needed
  display_name      VARCHAR(128),
  avatar_url        VARCHAR(512),
  auth_provider     VARCHAR(32) NOT NULL DEFAULT 'email',  -- 'email' | 'google'
  google_uid        VARCHAR(256) UNIQUE,           -- Firebase UID for Google users
  email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE, -- soft disable instead of DELETE
  storage_used_bytes BIGINT NOT NULL DEFAULT 0,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_google_uid ON users(google_uid) WHERE google_uid IS NOT NULL;
CREATE INDEX idx_users_created_at ON users(created_at);

-- =============================================================
-- TABLE: user_preferences
-- Per-user settings (theme, language, compression defaults)
-- =============================================================
CREATE TABLE user_preferences (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  language             VARCHAR(8) NOT NULL DEFAULT 'en',
  theme                VARCHAR(16) NOT NULL DEFAULT 'system',      -- 'light' | 'dark' | 'system'
  accent_color         VARCHAR(32) NOT NULL DEFAULT 'ember',       -- 'ember' | 'indigo' | 'teal' | 'violet' | 'navy'
  font_size            VARCHAR(16) NOT NULL DEFAULT 'medium',      -- 'small' | 'medium' | 'large'
  font_family          VARCHAR(32) NOT NULL DEFAULT 'inter',
  default_compression  VARCHAR(16) NOT NULL DEFAULT 'medium',      -- 'low' | 'medium' | 'high'
  auto_delete_files    BOOLEAN NOT NULL DEFAULT FALSE,
  email_notifications  BOOLEAN NOT NULL DEFAULT TRUE,
  output_folder_path   VARCHAR(512),
  background_animation BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- TABLE: refresh_tokens
-- Persistent refresh token store. Replaces Redis refresh token storage.
-- Access tokens remain stateless JWT (not stored).
-- =============================================================
CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   VARCHAR(256) NOT NULL UNIQUE,  -- SHA-256 hash of the actual token, NEVER store plaintext
  device_hint  VARCHAR(256),                  -- User-agent snippet for display ("Chrome on Windows")
  ip_address   INET,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,                   -- NULL = active, non-NULL = revoked
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
-- Partial index: only active tokens
CREATE INDEX idx_refresh_tokens_active ON refresh_tokens(token_hash) WHERE revoked_at IS NULL;

-- =============================================================
-- TABLE: jobs
-- Persistent record of every conversion/compression/torrent job.
-- Redis stores live progress; this table stores final state.
-- =============================================================
CREATE TABLE jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL = anonymous job
  bullmq_job_id   VARCHAR(256),                    -- BullMQ job ID for cross-reference
  job_type        VARCHAR(32) NOT NULL,            -- 'conversion' | 'compression' | 'torrent'
  status          VARCHAR(32) NOT NULL DEFAULT 'queued',
                  -- 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  input_filename  VARCHAR(512) NOT NULL,
  input_size_bytes BIGINT,
  output_filename VARCHAR(512),
  output_size_bytes BIGINT,
  input_format    VARCHAR(32),                     -- 'pdf' | 'docx' | 'png' etc.
  output_format   VARCHAR(32),
  conversion_type VARCHAR(64),                     -- e.g. 'docx_to_pdf' | 'image_compress' | 'torrent_download'
  options_json    JSONB,                           -- job-specific options (quality, DPI, preset, etc.)
  error_message   TEXT,
  progress        SMALLINT CHECK (progress BETWEEN 0 AND 100),
  queued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,                     -- when the output file will be deleted
  storage_path    VARCHAR(1024),                   -- internal storage path (never exposed to client)
  download_token  VARCHAR(256) UNIQUE              -- secure random token for file download
);

-- Indexes
CREATE INDEX idx_jobs_user_id ON jobs(user_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_queued_at ON jobs(queued_at DESC);
CREATE INDEX idx_jobs_user_id_queued_at ON jobs(user_id, queued_at DESC);
CREATE INDEX idx_jobs_download_token ON jobs(download_token) WHERE download_token IS NOT NULL;
CREATE INDEX idx_jobs_bullmq_id ON jobs(bullmq_job_id) WHERE bullmq_job_id IS NOT NULL;

-- =============================================================
-- TABLE: audit_logs
-- Immutable security audit trail. INSERT-only — never UPDATE or DELETE.
-- Captures auth events, file operations, admin actions, errors.
-- =============================================================
CREATE TABLE audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type   VARCHAR(64) NOT NULL,
  severity     VARCHAR(16) NOT NULL DEFAULT 'info',   -- 'info' | 'warn' | 'error' | 'critical'
  ip_address   INET,
  user_agent   VARCHAR(512),
  resource_id  VARCHAR(256),                          -- Job ID, file ID, etc.
  metadata     JSONB,                                 -- Extra context (never include passwords or secrets)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for audit log queries
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_severity ON audit_logs(severity) WHERE severity IN ('error', 'critical');
CREATE INDEX idx_audit_logs_ip ON audit_logs(ip_address);

-- =============================================================
-- TABLE: file_quota_overrides
-- Per-user storage/job quota overrides (for future premium tiers)
-- =============================================================
CREATE TABLE file_quota_overrides (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_storage_bytes    BIGINT NOT NULL DEFAULT 2147483648,  -- 2 GB default
  max_jobs_per_day     INTEGER NOT NULL DEFAULT 50,
  max_file_size_bytes  BIGINT NOT NULL DEFAULT 104857600,   -- 100 MB default
  plan_name            VARCHAR(64) NOT NULL DEFAULT 'free',  -- 'free' | 'pro' | 'enterprise'
  plan_expires_at      TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- TRIGGERS: auto-update updated_at
-- =============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================
-- TRIGGER: block UPDATE and DELETE on audit_logs (immutability)
-- =============================================================
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is insert-only — modifications are not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

-- =============================================================
-- ROW LEVEL SECURITY (RLS)
-- Users can only see their own data. Enforced at DB level,
-- not just application level — defense in depth.
-- =============================================================

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users table
-- The app passes current user_id via SET LOCAL app.current_user_id = '...'
CREATE POLICY users_self_read ON users
  FOR SELECT TO docflow_api
  USING (id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY users_self_update ON users
  FOR UPDATE TO docflow_api
  USING (id = current_setting('app.current_user_id', true)::UUID);

-- RLS Policies: user_preferences
CREATE POLICY prefs_self_all ON user_preferences
  FOR ALL TO docflow_api
  USING (user_id = current_setting('app.current_user_id', true)::UUID);

-- RLS Policies: refresh_tokens
CREATE POLICY tokens_self_all ON refresh_tokens
  FOR ALL TO docflow_api
  USING (user_id = current_setting('app.current_user_id', true)::UUID);

-- RLS Policies: jobs
CREATE POLICY jobs_self_read ON jobs
  FOR SELECT TO docflow_api
  USING (
    user_id = current_setting('app.current_user_id', true)::UUID
    OR user_id IS NULL  -- anonymous jobs visible to creator by session — handled at app layer
  );

CREATE POLICY jobs_self_insert ON jobs
  FOR INSERT TO docflow_api
  WITH CHECK (
    user_id = current_setting('app.current_user_id', true)::UUID
    OR user_id IS NULL
  );

-- =============================================================
-- GRANT PERMISSIONS TO ROLES
-- =============================================================

-- docflow_api role
GRANT SELECT, INSERT, UPDATE ON users TO docflow_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_preferences TO docflow_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON refresh_tokens TO docflow_api;
GRANT SELECT, INSERT ON jobs TO docflow_api;
GRANT INSERT ON audit_logs TO docflow_api;
GRANT SELECT ON file_quota_overrides TO docflow_api;
GRANT USAGE ON SEQUENCE audit_logs_id_seq TO docflow_api;

-- docflow_worker role (no RLS bypass needed — workers use admin context)
GRANT SELECT ON users TO docflow_worker;
GRANT SELECT, INSERT, UPDATE ON jobs TO docflow_worker;
GRANT INSERT ON audit_logs TO docflow_worker;
GRANT USAGE ON SEQUENCE audit_logs_id_seq TO docflow_worker;

-- Future sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO docflow_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO docflow_worker;

COMMIT;
