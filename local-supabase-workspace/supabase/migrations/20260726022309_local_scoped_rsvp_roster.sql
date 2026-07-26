CREATE OR REPLACE FUNCTION public.get_targeted_event_attendance_roster(p_event_id uuid)
RETURNS TABLE (
  kind text,
  person_id uuid,
  display_name text,
  parent_id uuid,
  team_ids uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _club_id uuid;
  _team_id uuid;
  _targets uuid[];
  _authorized boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  SELECT e.club_id, e.team_id, e.target_team_ids
    INTO _club_id, _team_id, _targets
  FROM public.events e
  WHERE e.id = p_event_id;

  IF _club_id IS NULL THEN
    RETURN;
  END IF;

  IF _team_id IS NOT NULL OR _targets IS NULL OR array_length(_targets, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(t.id) INTO _targets
  FROM public.teams t
  WHERE t.id = ANY(_targets) AND t.club_id = _club_id;

  IF _targets IS NULL OR array_length(_targets, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _uid
      AND (
        ur.role = 'app_admin'
        OR (ur.club_id = _club_id AND ur.role IN ('club_admin', 'committee_member'))
        OR (ur.role IN ('team_admin', 'coach', 'club_admin') AND ur.team_id = ANY(_targets))
      )
  ) INTO _authorized;

  IF NOT _authorized THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'child'::text,
         c.id,
         c.name,
         c.parent_id,
         array_agg(DISTINCT cta.team_id)
  FROM public.child_team_assignments cta
  JOIN public.children c ON c.id = cta.child_id
  WHERE cta.team_id = ANY(_targets)
  GROUP BY c.id, c.name, c.parent_id;

  RETURN QUERY
  SELECT 'adult'::text,
         p.id,
         p.display_name,
         NULL::uuid,
         array_agg(DISTINCT ur.team_id)
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.team_id = ANY(_targets)
  GROUP BY p.id, p.display_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_targeted_event_attendance_roster(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_targeted_event_attendance_roster(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_targeted_event_attendance_roster(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_targeted_event_attendance_roster(uuid) TO service_role;
