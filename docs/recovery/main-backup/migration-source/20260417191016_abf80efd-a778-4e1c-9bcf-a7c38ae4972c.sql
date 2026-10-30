
-- Phase 6: Season analytics RPCs
-- Returns per-team summary for a season: events held, avg attendance %, current roster size
CREATE OR REPLACE FUNCTION public.season_team_summary(_season_id uuid)
RETURNS TABLE (
  team_id uuid,
  team_name text,
  events_count integer,
  avg_attendance_pct numeric,
  roster_size integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club_id uuid;
  _season_start date;
  _season_end date;
BEGIN
  SELECT club_id, start_date, end_date
  INTO _club_id, _season_start, _season_end
  FROM public.seasons WHERE id = _season_id;

  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Season not found';
  END IF;

  -- Access: app_admin, club_admin, or any coach/team_admin in this club
  IF NOT (
    public.has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    OR public.is_club_admin(auth.uid(), _club_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.teams t ON t.id = ur.team_id
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('coach'::app_role, 'team_admin'::app_role)
        AND t.club_id = _club_id
    )
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH season_teams AS (
    SELECT t.id, t.name
    FROM public.teams t
    WHERE t.season_id = _season_id
  ),
  team_events AS (
    SELECT
      e.team_id,
      e.id AS event_id
    FROM public.events e
    JOIN season_teams st ON st.id = e.team_id
    WHERE e.is_cancelled = false
      AND (_season_start IS NULL OR e.event_date::date >= _season_start)
      AND (_season_end IS NULL OR e.event_date::date <= _season_end)
  ),
  roster AS (
    SELECT team_id, COUNT(*)::int AS size
    FROM public.team_memberships
    WHERE season_id = _season_id
      AND status = 'active'
      AND role = 'player'
    GROUP BY team_id
  ),
  attendance AS (
    SELECT
      te.team_id,
      COUNT(*) FILTER (WHERE r.status = 'going')::numeric AS going_count,
      COUNT(*)::numeric AS total_rsvps
    FROM team_events te
    LEFT JOIN public.rsvps r ON r.event_id = te.event_id
    GROUP BY te.team_id
  ),
  event_counts AS (
    SELECT team_id, COUNT(DISTINCT event_id)::int AS events_count
    FROM team_events
    GROUP BY team_id
  )
  SELECT
    st.id AS team_id,
    st.name AS team_name,
    COALESCE(ec.events_count, 0) AS events_count,
    CASE
      WHEN COALESCE(a.total_rsvps, 0) = 0 THEN 0::numeric
      ELSE ROUND((a.going_count / a.total_rsvps) * 100, 1)
    END AS avg_attendance_pct,
    COALESCE(r.size, 0) AS roster_size
  FROM season_teams st
  LEFT JOIN event_counts ec ON ec.team_id = st.id
  LEFT JOIN attendance a ON a.team_id = st.id
  LEFT JOIN roster r ON r.team_id = st.id
  ORDER BY st.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_team_summary(uuid) TO authenticated;

-- Per-player stats within a season: attendance % and games played
CREATE OR REPLACE FUNCTION public.season_player_stats(_season_id uuid, _team_id uuid)
RETURNS TABLE (
  club_player_id uuid,
  player_name text,
  events_total integer,
  events_attended integer,
  attendance_pct numeric,
  games_played integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _club_id uuid;
  _season_start date;
  _season_end date;
BEGIN
  SELECT s.club_id, s.start_date, s.end_date
  INTO _club_id, _season_start, _season_end
  FROM public.seasons s WHERE s.id = _season_id;

  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Season not found';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    OR public.is_club_admin(auth.uid(), _club_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('coach'::app_role, 'team_admin'::app_role)
        AND ur.team_id = _team_id
    )
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT tm.club_player_id, cp.display_name, cp.profile_id, cp.child_id
    FROM public.team_memberships tm
    JOIN public.club_players cp ON cp.id = tm.club_player_id
    WHERE tm.season_id = _season_id
      AND tm.team_id = _team_id
      AND tm.status = 'active'
      AND tm.role = 'player'
  ),
  team_events AS (
    SELECT e.id AS event_id, e.type
    FROM public.events e
    WHERE e.team_id = _team_id
      AND e.is_cancelled = false
      AND (_season_start IS NULL OR e.event_date::date >= _season_start)
      AND (_season_end IS NULL OR e.event_date::date <= _season_end)
  ),
  rsvp_stats AS (
    SELECT
      r.club_player_id,
      COUNT(DISTINCT te.event_id)::int AS events_total,
      COUNT(DISTINCT te.event_id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM public.rsvps rs
          WHERE rs.event_id = te.event_id
            AND rs.status = 'going'
            AND (
              (r.profile_id IS NOT NULL AND rs.user_id = r.profile_id)
              OR (r.child_id IS NOT NULL AND rs.child_id = r.child_id)
            )
        )
      )::int AS events_attended,
      COUNT(DISTINCT te.event_id) FILTER (
        WHERE te.type = 'game'
          AND EXISTS (
            SELECT 1 FROM public.rsvps rs
            WHERE rs.event_id = te.event_id
              AND rs.status = 'going'
              AND (
                (r.profile_id IS NOT NULL AND rs.user_id = r.profile_id)
                OR (r.child_id IS NOT NULL AND rs.child_id = r.child_id)
              )
          )
      )::int AS games_played
    FROM roster r
    CROSS JOIN team_events te
    GROUP BY r.club_player_id
  )
  SELECT
    r.club_player_id,
    r.display_name AS player_name,
    COALESCE(rs.events_total, 0) AS events_total,
    COALESCE(rs.events_attended, 0) AS events_attended,
    CASE
      WHEN COALESCE(rs.events_total, 0) = 0 THEN 0::numeric
      ELSE ROUND((rs.events_attended::numeric / rs.events_total) * 100, 1)
    END AS attendance_pct,
    COALESCE(rs.games_played, 0) AS games_played
  FROM roster r
  LEFT JOIN rsvp_stats rs ON rs.club_player_id = r.club_player_id
  ORDER BY attendance_pct DESC NULLS LAST, r.display_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.season_player_stats(uuid, uuid) TO authenticated;

-- Team history for a user/profile: current + past team memberships across all clubs
CREATE OR REPLACE FUNCTION public.profile_team_history(_profile_id uuid)
RETURNS TABLE (
  membership_id uuid,
  team_id uuid,
  team_name text,
  team_level_age text,
  club_id uuid,
  club_name text,
  season_id uuid,
  season_name text,
  season_status season_status,
  season_start_date date,
  season_end_date date,
  joined_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tm.id AS membership_id,
    tm.team_id,
    t.name AS team_name,
    t.level_age AS team_level_age,
    t.club_id,
    c.name AS club_name,
    tm.season_id,
    s.name AS season_name,
    s.status AS season_status,
    s.start_date AS season_start_date,
    s.end_date AS season_end_date,
    tm.joined_at
  FROM public.team_memberships tm
  JOIN public.club_players cp ON cp.id = tm.club_player_id
  JOIN public.teams t ON t.id = tm.team_id
  JOIN public.clubs c ON c.id = t.club_id
  JOIN public.seasons s ON s.id = tm.season_id
  WHERE cp.profile_id = _profile_id
    AND tm.role = 'player'
    AND tm.status = 'active'
  ORDER BY s.start_date DESC NULLS LAST, s.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.profile_team_history(uuid) TO authenticated;
