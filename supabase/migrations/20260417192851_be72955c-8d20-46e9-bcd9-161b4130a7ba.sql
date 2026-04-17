-- Archive notification
CREATE OR REPLACE FUNCTION public.notify_season_archived(_season_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club_id uuid;
  _season_name text;
  _inserted int := 0;
BEGIN
  SELECT club_id, name INTO _club_id, _season_name
  FROM public.seasons WHERE id = _season_id;

  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Season not found';
  END IF;

  IF NOT public.is_club_admin(auth.uid(), _club_id) THEN
    RAISE EXCEPTION 'Only club admins can send season archive notifications';
  END IF;

  WITH placements AS (
    SELECT DISTINCT
      tm.team_id,
      t.name AS team_name,
      cp.profile_id,
      cp.child_id
    FROM public.team_memberships tm
    JOIN public.teams t ON t.id = tm.team_id
    JOIN public.club_players cp ON cp.id = tm.club_player_id
    WHERE tm.season_id = _season_id
      AND tm.status = 'active'
  ),
  recipients AS (
    SELECT p.profile_id AS user_id, p.team_id, p.team_name
    FROM placements p
    WHERE p.profile_id IS NOT NULL AND p.child_id IS NULL
    UNION
    SELECT cg.guardian_id AS user_id, p.team_id, p.team_name
    FROM placements p
    JOIN public.child_guardians cg ON cg.child_id = p.child_id
    WHERE p.child_id IS NOT NULL
  ),
  inserts AS (
    INSERT INTO public.notifications (user_id, type, message, related_id)
    SELECT
      r.user_id,
      'season_archived',
      _season_name || ' has been archived. History is preserved on ' || r.team_name || '.',
      r.team_id
    FROM recipients r
    RETURNING 1
  )
  SELECT COUNT(*) INTO _inserted FROM inserts;

  RETURN _inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_season_archived(uuid) TO authenticated;

-- Orphan events audit: events whose team has no season
CREATE OR REPLACE FUNCTION public.season_orphan_events(_club_id uuid)
RETURNS TABLE (
  event_id uuid,
  title text,
  event_date date,
  team_id uuid,
  team_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.title, e.event_date, e.team_id, t.name
  FROM public.events e
  JOIN public.teams t ON t.id = e.team_id
  WHERE e.club_id = _club_id
    AND t.season_id IS NULL
  ORDER BY e.event_date DESC
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.season_orphan_events(uuid) TO authenticated;