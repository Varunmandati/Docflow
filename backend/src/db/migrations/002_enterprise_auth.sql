-- =============================================================
-- DocFlow Database Schema — Migration 002
-- Enterprise Authentication Update
-- =============================================================

BEGIN;

-- 1. Add password_hash to users table
ALTER TABLE users ADD COLUMN password_hash VARCHAR(256);

-- 2. Create OTPs table for database-backed authentication flows
CREATE TABLE otps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  email           CITEXT NOT NULL,
  purpose         VARCHAR(32) NOT NULL, -- 'registration', 'login', 'password_reset', 'email_change'
  hashed_otp      VARCHAR(256) NOT NULL,
  attempt_count   SMALLINT NOT NULL DEFAULT 0,
  resend_count    SMALLINT NOT NULL DEFAULT 0,
  last_resend_at  TIMESTAMPTZ,
  verified_at     TIMESTAMPTZ,
  ip_address      INET,
  user_agent      VARCHAR(512),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups and cleanup
CREATE INDEX idx_otps_email ON otps(email);
CREATE INDEX idx_otps_user_id ON otps(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_otps_purpose ON otps(purpose);
CREATE INDEX idx_otps_expires_at ON otps(expires_at);

-- RLS setup for otps (only system access is really needed, but if user accessed, here it is)
ALTER TABLE otps ENABLE ROW LEVEL SECURITY;

-- The API and worker need full access to otps because they manage the lifecycle,
-- and often the user isn't authenticated yet (e.g. registration, forgot password)
-- so RLS here is mostly to prevent public schema access if roles get misconfigured.
CREATE POLICY otps_api_all ON otps
  FOR ALL TO docflow_api
  USING (true)
  WITH CHECK (true);

CREATE POLICY otps_worker_all ON otps
  FOR ALL TO docflow_worker
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON otps TO docflow_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON otps TO docflow_worker;

COMMIT;
