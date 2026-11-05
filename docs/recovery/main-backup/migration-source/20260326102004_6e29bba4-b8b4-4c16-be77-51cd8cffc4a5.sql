CREATE OR REPLACE FUNCTION public.create_child_for_parent_on_team(
  p_parent_user_id uuid,
  p_team_id uuid,
  p_name text,
  p_year_of_birth integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child_id uuid;
  v_club_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Child name is required';
  END IF;

  SELECT t.club_id
  INTO v_club_id
  FROM public.teams t
  WHERE t.id = p_team_id;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'Team not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        (ur.team_id = p_team_id AND ur.role IN ('team_admin', 'coach', 'app_admin'))
        OR (ur.club_id = v_club_id AND ur.role IN ('club_admin', 'committee_member', 'app_admin'))
      )
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.children (parent_id, name, year_of_birth)
  VALUES (p_parent_user_id, btrim(p_name), p_year_of_birth)
  RETURNING id INTO v_child_id;

  INSERT INTO public.child_team_assignments (child_id, team_id)
  VALUES (v_child_id, p_team_id)
  ON CONFLICT DO NOTHING;

  RETURN v_child_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_child_for_parent_on_team(uuid, uuid, text, integer) TO authenticated;