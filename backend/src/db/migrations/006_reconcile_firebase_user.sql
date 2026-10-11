-- reconcile_firebase_user(new_uid, email)
--
-- Called by user.service.findOrCreateFirebaseUser on every authenticated
-- request, BEFORE the users upsert. If the same email already exists under a
-- different Firebase uid (recreated Firebase account, legacy row predating a
-- uid change), migrate that row and its children to the authoritative uid so
-- the following INSERT never collides on users_email_key.
--
-- SECURITY DEFINER: runs as the migration/admin role, bypassing the RLS
-- policies that would otherwise reject cross-uid updates when called inside
-- the caller's user context.
--
-- This function previously existed only in the development database (created
-- manually) and was missing from Neon, breaking OTP verification in
-- production with: function reconcile_firebase_user(unknown, unknown) does
-- not exist. This migration makes it part of the schema history.
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

  UPDATE user_preferences SET user_id = p_new_uid WHERE user_id = v_old_uid;
  UPDATE refresh_tokens    SET user_id = p_new_uid WHERE user_id = v_old_uid;
  UPDATE otps              SET user_id = p_new_uid WHERE user_id = v_old_uid;
  UPDATE file_quota_overrides SET user_id = p_new_uid WHERE user_id = v_old_uid;
  UPDATE jobs              SET user_id = p_new_uid WHERE user_id = v_old_uid;
  UPDATE audit_logs        SET user_id = p_new_uid WHERE user_id = v_old_uid;
  UPDATE users             SET id = p_new_uid WHERE id = v_old_uid;

  RETURN p_new_uid;
END;
$function$
