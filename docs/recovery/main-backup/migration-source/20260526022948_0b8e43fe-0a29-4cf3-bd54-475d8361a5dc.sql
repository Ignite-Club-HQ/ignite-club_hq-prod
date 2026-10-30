
CREATE OR REPLACE FUNCTION public.list_club_parents_for_team(p_team_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT t.club_id INTO v_club_id FROM public.teams t WHERE t.id = p_team_id;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'Team not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.team_id = p_team_id AND ur.role IN ('team_admin','coach','app_admin'))
        OR (ur.club_id = v_club_id AND ur.role IN ('club_admin','committee_member','app_admin'))
        OR ur.role = 'app_admin'
      )
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (ur.user_id)
    ur.user_id,
    p.display_name,
    p.avatar_url,
    ur.role::text
  FROM public.user_roles ur
  LEFT JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.club_id = v_club_id
    AND ur.role IN ('parent','team_admin','coach','club_admin','committee_member')
    AND ur.user_id IS NOT NULL
  ORDER BY ur.user_id, CASE ur.role
    WHEN 'parent' THEN 1
    WHEN 'team_admin' THEN 2
    WHEN 'coach' THEN 3
    WHEN 'club_admin' THEN 4
    WHEN 'committee_member' THEN 5
    ELSE 6 END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_club_parents_for_team(uuid) TO authenticated;
