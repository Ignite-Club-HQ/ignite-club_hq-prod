CREATE OR REPLACE FUNCTION public.get_team_children_for_pitch_board(p_team_id uuid)
RETURNS TABLE(assignment_id uuid, child_id uuid, child_name text, year_of_birth integer, parent_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Allow access if user has a role on this team
  -- OR if user is a club_admin for the club that owns this team
  -- OR if user is an app_admin
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.team_id = p_team_id
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.teams t ON t.club_id = ur.club_id
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'club_admin'
      AND t.id = p_team_id
  ) AND NOT public.has_role(auth.uid(), 'app_admin', NULL, NULL) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    cta.id AS assignment_id,
    c.id AS child_id,
    c.name AS child_name,
    c.year_of_birth,
    c.parent_id
  FROM public.child_team_assignments cta
  JOIN public.children c ON c.id = cta.child_id
  WHERE cta.team_id = p_team_id
  ORDER BY c.name;
END;
$$;