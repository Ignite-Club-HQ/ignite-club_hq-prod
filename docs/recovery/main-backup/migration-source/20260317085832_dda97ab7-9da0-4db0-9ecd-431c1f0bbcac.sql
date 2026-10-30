-- Create a security definer function to clean up FCM tokens across users
-- This is needed because RLS prevents users from deleting other users' tokens
-- when the same device token gets reused after login/logout
CREATE OR REPLACE FUNCTION public.cleanup_fcm_token_for_user(p_token TEXT, p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete this token from any OTHER user (prevents cross-user notifications)
  DELETE FROM public.fcm_tokens
  WHERE token = p_token AND user_id != p_user_id;
END;
$$;

-- Also clean up the current duplicate tokens right now
-- Remove duplicates where the same token is assigned to multiple users
-- Keep only the most recently updated one
DELETE FROM public.fcm_tokens a
USING public.fcm_tokens b
WHERE a.token = b.token
  AND a.user_id != b.user_id
  AND a.updated_at < b.updated_at;