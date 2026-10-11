-- 008: reconcile_firebase_user — avoid unique-email conflict during migration
--
-- 007 fixed the FK ordering (create the authoritative users row before moving
-- any child rows) but its placeholder INSERT still used the real email address
-- in: the old users row is still holding it at that point, so the insert raised
--
--   duplicate key value violates unique constraint "users_email_key"
--
-- This version inserts the placeholder under a temporary, unique email derived
-- from the new uid, migrates the child rows, deletes the vacated old row, and
-- only then promotes the placeholder to the canonical email address.
CREATE OR REPLACE FUNCTION public.reconcile_firebase_user(p_new_uid text, p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_uid TEXT;
  v_temp_email TEXT;
BEGIN
  SELECT id INTO v_old_uid FROM users WHERE email = LOWER(p_email) AND id <> p_new_uid LIMIT 1;
  IF v_old_uid IS NULL THEN
    RETURN p_new_uid;
  END IF;

  v_temp_email := 'reconcile-' || p_new_uid || '@docflow.invalid';

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
  UPDATE audit_logs        SET user_id = p_new_uid WHERE user_id = v_old_uid;

  DELETE FROM users        WHERE id = v_old_uid;

  -- The canonical email is free again; adopt it only if our placeholder is
  -- still in place (a caller may have raced to set a real address already).
  UPDATE users SET email = LOWER(p_email)
   WHERE id = p_new_uid AND email = v_temp_email;

  RETURN p_new_uid;
END;
$function$