-- Admin-only wrapper around get_user_emails so the OnlineUsersTab (and other
-- admin UIs) can resolve emails for a list of user_ids without exposing
-- auth.users to general authenticated users.
CREATE OR REPLACE FUNCTION public.admin_get_user_emails(user_ids uuid[])
RETURNS TABLE (id uuid, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'app_admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text
  FROM auth.users u
  WHERE u.id = ANY(user_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_user_emails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_emails(uuid[]) TO authenticated;