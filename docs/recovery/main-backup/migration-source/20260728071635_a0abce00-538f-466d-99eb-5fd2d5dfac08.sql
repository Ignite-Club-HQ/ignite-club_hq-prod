CREATE OR REPLACE FUNCTION public.carry_over_players_to_teams(
  _target_season_id UUID,
  _assignments JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club_id UUID;
  _inserted INT := 0;
BEGIN
  SELECT club_id INTO _club_id FROM public.seasons WHERE id = _target_season_id;
  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Target season not found';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'app_admin')
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND club_id = _club_id AND role = 'club_admin'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to carry over players';
  END IF;

  WITH parsed AS (
    SELECT
      (elem->>'club_player_id')::uuid AS club_player_id,
      NULLIF(elem->>'team_id', '')::uuid AS team_id
    FROM jsonb_array_elements(COALESCE(_assignments, '[]'::jsonb)) AS elem
  ),
  valid AS (
    SELECT DISTINCT p.club_player_id, p.team_id
    FROM parsed p
    JOIN public.teams t
      ON t.id = p.team_id
     AND t.season_id = _target_season_id
     AND t.club_id = _club_id
     AND t.deleted_at IS NULL
    JOIN public.club_players cp
      ON cp.id = p.club_player_id
     AND cp.club_id = _club_id
  ),
  ins AS (
    INSERT INTO public.team_memberships (club_player_id, team_id, season_id, role, status, created_by)
    SELECT v.club_player_id, v.team_id, _target_season_id, 'player', 'active', auth.uid()
    FROM valid v
    ON CONFLICT (club_player_id, team_id, season_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  RETURN _inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.carry_over_players_to_teams(UUID, JSONB) TO authenticated;