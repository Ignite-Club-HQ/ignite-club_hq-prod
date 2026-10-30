-- Function: notify season published
-- Inserts one notification per placed-player user (adult player profile + child guardians).
-- Existing notifications-table trigger handles push delivery.
CREATE OR REPLACE FUNCTION public.notify_season_published(_season_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club_id UUID;
  _season_name TEXT;
  _inserted INTEGER := 0;
BEGIN
  SELECT club_id, name INTO _club_id, _season_name
  FROM public.seasons WHERE id = _season_id;

  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Season not found';
  END IF;

  IF NOT public.is_club_admin(auth.uid(), _club_id) THEN
    RAISE EXCEPTION 'Only club admins can send season publish notifications';
  END IF;

  -- One notification per (recipient_user, team) combo
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
      AND tm.role = 'player'
  ),
  recipients AS (
    -- Adult players notified directly
    SELECT p.profile_id AS user_id, p.team_id, p.team_name
    FROM placements p
    WHERE p.profile_id IS NOT NULL AND p.child_id IS NULL
    UNION
    -- Child players: notify each guardian
    SELECT cg.guardian_id AS user_id, p.team_id, p.team_name
    FROM placements p
    JOIN public.child_guardians cg ON cg.child_id = p.child_id
    WHERE p.child_id IS NOT NULL
  ),
  inserts AS (
    INSERT INTO public.notifications (user_id, type, message, related_id)
    SELECT
      r.user_id,
      'season_published',
      'You''ve been placed in ' || r.team_name || ' for ' || _season_name || ' 🎉',
      r.team_id
    FROM recipients r
    RETURNING 1
  )
  SELECT COUNT(*) INTO _inserted FROM inserts;

  RETURN _inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_season_published(UUID) TO authenticated;