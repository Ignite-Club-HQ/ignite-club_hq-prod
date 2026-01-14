-- Function to get user emails by user IDs (for email notifications)
-- This function is SECURITY DEFINER so it can access auth.users
CREATE OR REPLACE FUNCTION public.get_user_emails_by_ids(user_ids uuid[])
RETURNS TABLE(user_id uuid, email text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT au.id as user_id, au.email
  FROM auth.users au
  WHERE au.id = ANY(user_ids)
    AND au.email IS NOT NULL;
$$;