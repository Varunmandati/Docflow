-- 009: reconcile_firebase_user — respect the insert-only audit_logs trigger
--
-- 008 still failed on the next real collision:
--
--   audit_logs is insert-only — modifications are not permitted
--
--   SQL statement "UPDATE audit_logs SET user_id = p_new_uid
--   WHERE user_id = v_old_uid"  [PL/pgSQL function reconcile_firebase_user]
--
-- A BEFORE trigger (migration 002) rejects every UPDATE/DELETE on audit_logs —
-- the audit trail is immutable by design. Consequently the old row can never be
-- detached from its audit entries, and DELETE FROM users (attempted by 006-008)
-- would fail on the ON DELETE SET NULL FK action firing the same trigger.
--
-- This version never touches audit_logs and never deletes the old row: it
-- re-parents the mutable children (preferences, refresh tokens, otps, quota
-- overrides, jobs), then renames the vacated users row to a unique legacy
-- email so the audit entries keep their FK target and the canonical email
-- (users_email_key) becomes free for the authoritative uid. The tombstone row
-- is never matched by later reconciles because it no longer holds the email.
CREATE OR REPLACE FUNCTION public.reconcile_firebase_user(p_new_uid text, p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_uid TEXT;
  v_temp_email TEXT;
  v_legacy_email TEXT;
BEGIN
  SELECT id INTO v_old_uid FROM users WHERE email = LOWER(p_email) AND id <> p_new_uid LIMIT 1;
  IF v_old_uid IS NULL THEN
    RETURN p_new_uid;
  END IF;

  v_temp_email   := 'reconcile-' || p_new_uid  || '@docflow.invalid';
  v_legacy_email := 'legacy-'    || v_old_uid  || '@docflow.invalid';

  -- The authoritative row must exist before any FK-bearing child row can point
  -- at it, but the canonical email is still owned by v_old_uid — so register a
  -- placeholder under a unique temporary email and promote it at the end.
  INSERT INTO users (id, email, auth_provider, email_verified, last_login_at)
  VALUES (p_new_uid, v_temp_email, 'email', TRUE, NOW())
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

  -- audit_logs cannot follow (insert-only trigger); keep the account row alive
  -- under a unique legacy email so the immutable audit trail keeps its FK.
  UPDATE users SET email = v_legacy_email WHERE id = v_old_uid;

  -- Adopt the canonical address now that the legacy row no longer claims it.
  UPDATE users SET email = LOWER(p_email)
   WHERE id = p_new_uid AND email = v_temp_email;

  RETURN p_new_uid;
END;
$function$