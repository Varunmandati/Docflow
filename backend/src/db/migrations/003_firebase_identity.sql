-- =============================================================
-- DocFlow Database Schema — Migration 003
-- Firebase-native identity + production fixes
--
-- 1. users.id becomes the Firebase UID (TEXT) — the app authenticates
--    exclusively through Firebase, so the UUID surrogate key is removed.
-- 2. All FK columns referencing users(id) switch to TEXT.
-- 3. RLS policies rewritten for TEXT ids (no ::UUID casts).
-- 4. audit_logs and jobs gain INSERT/UPDATE policies so the API and
--    worker roles can actually write (previously denied under RLS).
-- 5. jobs gains live-state columns (stage/message/result_json) so job
--    state is DB-backed and survives restarts.
-- 6. docflow_worker gets BYPASSRLS — workers update job rows on behalf
--    of users without a user-scoped session.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- Drop FK constraints that reference users(id) before retyping
-- -------------------------------------------------------------
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname, conrelid::regclass AS tbl, confrelid::regclass AS ftbl
    FROM pg_constraint
    WHERE contype = 'f' AND confrelid = 'users'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', con.tbl, con.conname);
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- Drop ALL RLS policies on affected tables before retyping
-- (Postgres refuses ALTER TYPE while a policy depends on the column)
-- -------------------------------------------------------------
DO $$
DECLARE
  pol record;
  tbls text[] := ARRAY['users', 'user_preferences', 'refresh_tokens', 'jobs',
                       'audit_logs', 'file_quota_overrides', 'otps'];
  t text;
BEGIN
  FOREACH t IN ARRAY tbls
  LOOP
    FOR pol IN
      SELECT polname
      FROM pg_policy
      WHERE polrelid = format('%I', t)::regclass
    LOOP
      EXECUTE format('DROP POLICY %I ON %I', pol.polname, t);
    END LOOP;
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- users.id -> Firebase UID (TEXT)
-- -------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE users ALTER COLUMN id TYPE TEXT;
ALTER TABLE users ADD PRIMARY KEY (id);

-- -------------------------------------------------------------
-- Retype FK columns
-- -------------------------------------------------------------
ALTER TABLE user_preferences     ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE refresh_tokens       ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE jobs                 ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE audit_logs           ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE file_quota_overrides ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE otps                 ALTER COLUMN user_id TYPE TEXT;

-- -------------------------------------------------------------
-- Re-add FK constraints
-- -------------------------------------------------------------
ALTER TABLE user_preferences
  ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE file_quota_overrides
  ADD CONSTRAINT file_quota_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE otps
  ADD CONSTRAINT otps_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- -------------------------------------------------------------
-- Drop unused password_hash column (auth is Firebase-only)
-- -------------------------------------------------------------
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;

-- -------------------------------------------------------------
-- jobs: DB-backed live state
-- -------------------------------------------------------------
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stage VARCHAR(64);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS result_json JSONB;

-- -------------------------------------------------------------
-- RLS policies — rewritten for TEXT ids
-- -------------------------------------------------------------
CREATE POLICY users_self_read ON users
  FOR SELECT TO docflow_api
  USING (id = current_setting('app.current_user_id', true));

CREATE POLICY users_self_update ON users
  FOR UPDATE TO docflow_api
  USING (id = current_setting('app.current_user_id', true));

CREATE POLICY users_self_insert ON users
  FOR INSERT TO docflow_api
  WITH CHECK (id = current_setting('app.current_user_id', true));

CREATE POLICY prefs_self_all ON user_preferences
  FOR ALL TO docflow_api
  USING (user_id = current_setting('app.current_user_id', true));

CREATE POLICY tokens_self_all ON refresh_tokens
  FOR ALL TO docflow_api
  USING (user_id = current_setting('app.current_user_id', true));

CREATE POLICY jobs_self_read ON jobs
  FOR SELECT TO docflow_api
  USING (
    user_id = current_setting('app.current_user_id', true)
    OR user_id IS NULL
  );

CREATE POLICY jobs_self_insert ON jobs
  FOR INSERT TO docflow_api
  WITH CHECK (
    user_id = current_setting('app.current_user_id', true)
    OR user_id IS NULL
  );

CREATE POLICY jobs_self_update ON jobs
  FOR UPDATE TO docflow_api
  USING (
    user_id = current_setting('app.current_user_id', true)
    OR user_id IS NULL
  );

-- audit_logs: insert-only for both roles (the immutable trigger
-- already blocks UPDATE/DELETE). RLS previously denied ALL writes.
CREATE POLICY audit_insert_api ON audit_logs
  FOR INSERT TO docflow_api
  WITH CHECK (true);

CREATE POLICY audit_insert_worker ON audit_logs
  FOR INSERT TO docflow_worker
  WITH CHECK (true);

-- otps: managed by the system (user may be unauthenticated for
-- registration / password reset), so roles get full access.
CREATE POLICY otps_api_all ON otps
  FOR ALL TO docflow_api
  USING (true)
  WITH CHECK (true);

CREATE POLICY otps_worker_all ON otps
  FOR ALL TO docflow_worker
  USING (true)
  WITH CHECK (true);

-- -------------------------------------------------------------
-- Grants for new columns
-- -------------------------------------------------------------
GRANT UPDATE (status, progress, stage, message, result_json, output_filename,
              output_size_bytes, storage_path, download_token, error_message,
              started_at, completed_at, expires_at) ON jobs TO docflow_worker;

-- Workers update job rows on behalf of users without a user-scoped
-- RLS session, so bypass RLS for the worker role.
ALTER ROLE docflow_worker BYPASSRLS;

COMMIT;
