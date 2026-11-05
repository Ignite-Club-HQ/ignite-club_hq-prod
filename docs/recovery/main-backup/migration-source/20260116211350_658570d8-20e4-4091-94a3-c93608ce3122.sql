-- Restrict get_user_emails_by_ids to service role only
-- This function accesses auth.users and should not be callable by authenticated users

-- First revoke access from public and authenticated roles
REVOKE ALL ON FUNCTION public.get_user_emails_by_ids(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_emails_by_ids(uuid[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_user_emails_by_ids(uuid[]) FROM anon;

-- Grant access only to service_role (used by edge functions)
GRANT EXECUTE ON FUNCTION public.get_user_emails_by_ids(uuid[]) TO service_role;