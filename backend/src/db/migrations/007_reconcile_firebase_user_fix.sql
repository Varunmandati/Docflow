-- 007: Fix reconcile_firebase_user FK ordering
--
-- The function introduced in 006 migrated a user's child rows to the
-- authoritative uid BEFORE a users row for that uid existed. Every child table
-- (user_preferences, refresh_tokens, otps, file_quota_overrides, jobs,
-- audit_logs) carries an immediate FOREIGN KEY back to users(id), so those
-- UPDATEs failed with:
--
--   insert or update on table "user_preferences" violates foreign key
--   constraint "user_preferences_user_id_fkey"
--
-- whenever a duplicate-email account needed reconciling. ensureUserExists then
-- aborted, /v1/profile came back empty, and every subsequent job INSERT on the
-- same uid failed with jobs_user_id_fkey.
--
-- Fix: create the authoritative users row first (idempotent ON CONFLICT), then
-- migrate the child rows, then drop the vacated row. user_preferences and
-- file_quota_overrides are per-user singletons keyed by user_id, so they are
-- only moved when the target uid is not already present, avoiding a
-- primary-key collision.
CREATE OR REPLACE FUNCTION public.reconcile_firebase_user(p_new_uid text, p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_uid TEXT;
BEGIN
  SELECT id INTO v_old_uid FROM users WHERE email = LOWER(p_email) AND id <> p_new_uid LIMIT 1;
  IF v_old_uid IS NULL THEN
    RETURN p_new_uid;
  END IF;

  -- The authoritative row must exist before any FK-bearing child row can point
  -- at it. The caller (user.service.findOrCreateFirebaseUser) inserts the full
  -- profile right after this function returns, so a minimal placeholder is
  -- enough here; ON CONFLICT keeps this re-runnable.
  INSERT INTO users (id, email, auth_provider, email_verified, last_login_at)
  VALUES (p_new_uid, LOWER(p_email), 'email', TRUE, NOW())
  ON CONFLICT (id) DO NOTHING;

  UPDATE user_preferences
     SET user_id = p_new_uid
   WHERE user_id = v_old_uid
     AND NOT EXISTS (SELECT 1 FROM user_preferences WHERE user_id = p_new_uid);

  UPDATE refresh_tokens    SET user_id = p_new_uid WHERE user_id = v_old_uid;
  UPDATE otps              SET user_id = p_new_uid WHERE user_id = v_old_uid;

  UPDATE file_quota_overrides
     SET user_id = p_new_uid
   WHERE user_id = v_old_uid
     AND NOT EXISTS (SELECT 1 FROM file_quota_overrides WHERE user_id = p_new_uid);

  UPDATE jobs              SET user_id = p_new_uid WHERE user_id = v_old_uid;
  UPDATE audit_logs        SET user_id = p_new_uid WHERE user_id = v_old_uid;

  DELETE FROM users        WHERE id = v_old_uid;

  RETURN p_new_uid;
END;
$function$