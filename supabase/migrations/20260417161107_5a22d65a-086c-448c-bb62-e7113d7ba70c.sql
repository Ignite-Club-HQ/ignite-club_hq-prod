
-- RPC: list returning players for a source season (grouped by their old team)
CREATE OR REPLACE FUNCTION public.get_returning_players(_source_season_id UUID)
RETURNS TABLE (
  club_player_id UUID,
  display_name TEXT,
  date_of_birth DATE,
  age_years INT,
  previous_team_id UUID,
  previous_team_name TEXT,
  membership_role public.team_membership_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cp.id AS club_player_id,
    cp.display_name,
    cp.date_of_birth,
    CASE WHEN cp.date_of_birth IS NOT NULL
      THEN EXTRACT(YEAR FROM AGE(cp.date_of_birth))::INT
      ELSE NULL END AS age_years,
    t.id AS previous_team_id,
    t.name AS previous_team_name,
    tm.role AS membership_role
  FROM public.team_memberships tm
  JOIN public.club_players cp ON cp.id = tm.club_player_id
  JOIN public.teams t ON t.id = tm.team_id
  WHERE tm.season_id = _source_season_id
    AND tm.status = 'active'
    AND cp.is_active = true
    AND (
      public.has_role(auth.uid(), 'app_admin')
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.club_id = cp.club_id
          AND ur.role = 'club_admin'
      )
    )
  ORDER BY t.name, cp.display_name;
$$;

-- RPC: carry over a set of club_players into a new season.
-- Default behaviour: place each player into the team in `_target_season_id` whose name matches their previous team (if any).
-- If no name match, they're left unassigned (admin can assign later).
CREATE OR REPLACE FUNCTION public.carry_over_players(
  _source_season_id UUID,
  _target_season_id UUID,
  _club_player_ids UUID[]
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
  -- Resolve club from target season
  SELECT club_id INTO _club_id FROM public.seasons WHERE id = _target_season_id;
  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Target season not found';
  END IF;

  -- Auth: app_admin or club_admin of this club
  IF NOT (
    public.has_role(auth.uid(), 'app_admin')
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND club_id = _club_id AND role = 'club_admin'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to carry over players';
  END IF;

  -- Insert memberships by matching old team name to new team name within the target season
  WITH src AS (
    SELECT
      tm.club_player_id,
      t_old.name AS old_team_name
    FROM public.team_memberships tm
    JOIN public.teams t_old ON t_old.id = tm.team_id
    WHERE tm.season_id = _source_season_id
      AND tm.status = 'active'
      AND tm.club_player_id = ANY(_club_player_ids)
      AND tm.role = 'player'
  ),
  matched AS (
    SELECT
      src.club_player_id,
      t_new.id AS new_team_id
    FROM src
    JOIN public.teams t_new
      ON t_new.season_id = _target_season_id
     AND t_new.name = src.old_team_name
  ),
  ins AS (
    INSERT INTO public.team_memberships (club_player_id, team_id, season_id, role, status, created_by)
    SELECT m.club_player_id, m.new_team_id, _target_season_id, 'player', 'active', auth.uid()
    FROM matched m
    ON CONFLICT (club_player_id, team_id, season_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  RETURN _inserted;
END;
$$;
