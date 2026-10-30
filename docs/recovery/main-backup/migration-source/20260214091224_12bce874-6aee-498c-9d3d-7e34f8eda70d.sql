
-- Create a security definer function to check messages_enabled for multiple users
-- This avoids RLS restrictions while only exposing the minimal needed data
CREATE OR REPLACE FUNCTION public.get_members_messages_enabled(member_ids uuid[])
RETURNS TABLE(user_id uuid, messages_enabled boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT np.user_id, np.messages_enabled
  FROM notification_preferences np
  WHERE np.user_id = ANY(member_ids);
$$;
