
CREATE OR REPLACE FUNCTION public.get_members_push_reachable(member_ids uuid[])
RETURNS TABLE(user_id uuid, has_push boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.id AS user_id,
    (
      EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = m.id)
      OR EXISTS (SELECT 1 FROM public.fcm_tokens ft WHERE ft.user_id = m.id)
    ) AS has_push
  FROM unnest(member_ids) AS m(id);
$$;
