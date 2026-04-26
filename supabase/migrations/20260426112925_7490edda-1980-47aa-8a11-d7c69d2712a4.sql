-- RPC: get_user_emails
-- Returns email addresses for an array of user IDs by querying auth.users directly.
-- This eliminates the need for edge functions to call supabase.auth.admin.getUserById(...)
-- one-by-one, which exhausts the auth admin connection pool when fan-out batches run.
--
-- Security: SECURITY DEFINER + restricted to service_role so only edge functions
-- (which use the service role key) can call it. Anon/authenticated users CANNOT
-- call this RPC, so no email leakage.

CREATE OR REPLACE FUNCTION public.get_user_emails(user_ids uuid[])
RETURNS TABLE (id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id, u.email::text
  FROM auth.users u
  WHERE u.id = ANY(user_ids)
    AND u.email IS NOT NULL;
$$;

-- Lock down: revoke from anon and authenticated; only service_role may execute.
REVOKE ALL ON FUNCTION public.get_user_emails(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_emails(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_user_emails(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_emails(uuid[]) TO service_role;

COMMENT ON FUNCTION public.get_user_emails(uuid[]) IS
  'Service-role-only batch lookup of email addresses by user id. Used by notification edge functions to avoid exhausting the auth admin connection pool.';