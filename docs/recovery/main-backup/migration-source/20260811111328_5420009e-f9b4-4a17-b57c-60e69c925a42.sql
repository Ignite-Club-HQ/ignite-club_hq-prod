CREATE OR REPLACE FUNCTION public.get_targeted_event_notification_recipients(p_event_id uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Targeted club-wide events only.
  IF _team_id IS NOT NULL OR _targets IS NULL OR array_length(_targets, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Cross-club guard: only teams genuinely belonging to this event's club.
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
  WITH scoped_children AS (
    SELECT DISTINCT c.id, c.parent_id
    FROM public.child_team_assignments cta
    JOIN public.children c ON c.id = cta.child_id
    WHERE cta.team_id = ANY(_targets)
  ),
  role_adults AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.team_id = ANY(_targets)
      AND ur.user_id IS NOT NULL
  ),
  parents AS (
    SELECT DISTINCT sc.parent_id AS user_id
    FROM scoped_children sc
    WHERE sc.parent_id IS NOT NULL
  ),
  guardians AS (
    SELECT DISTINCT cg.guardian_id AS user_id
    FROM public.child_guardians cg
    WHERE cg.child_id IN (SELECT id FROM scoped_children)
      AND cg.guardian_id IS NOT NULL
  )
  SELECT u.user_id FROM (
    SELECT user_id FROM role_adults
    UNION
    SELECT user_id FROM parents
    UNION
    SELECT user_id FROM guardians
  ) u;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_targeted_event_notification_recipients(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_targeted_event_notification_recipients(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_targeted_event_notification_recipients(uuid) TO authenticated;