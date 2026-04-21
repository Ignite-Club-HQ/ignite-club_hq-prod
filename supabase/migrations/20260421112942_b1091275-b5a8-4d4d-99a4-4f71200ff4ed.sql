CREATE OR REPLACE FUNCTION public.get_online_users_from_set(_user_ids uuid[])
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT up.user_id
  FROM public.user_presence up
  WHERE up.user_id = ANY(_user_ids)
    AND up.last_seen_at > (now() - interval '5 minutes');
$$;