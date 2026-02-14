
CREATE OR REPLACE FUNCTION public.get_members_events_enabled(member_ids uuid[])
RETURNS TABLE(user_id uuid, events_enabled boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT np.user_id, np.events_enabled
  FROM notification_preferences np
  WHERE np.user_id = ANY(member_ids);
END;
$$;
