CREATE OR REPLACE FUNCTION public.get_teams_leaderboard(
  _club_id uuid,
  _window text,
  _limit integer
) RETURNS TABLE (
  rank int,
  team_id uuid,
  team_name text,
  points int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start timestamptz;
  _is_all_time boolean := (_window = 'all');
BEGIN
  IF _window = 'week' THEN
    _start := date_trunc('week', now());
  ELSIF _window = 'month' THEN
    _start := date_trunc('month', now());
  ELSE
    _start := '1900-01-01'::timestamptz;
  END IF;

  RETURN QUERY
  WITH club_teams AS (
    SELECT t.id AS tid, t.name AS tname
    FROM public.teams t
    WHERE t.club_id = _club_id
  ),
  team_member_users AS (
    -- Direct team roles
    SELECT DISTINCT ct.tid, ur.user_id AS uid
    FROM club_teams ct
    JOIN public.user_roles ur ON ur.team_id = ct.tid
    WHERE ur.user_id IS NOT NULL
  ),
  team_member_children AS (
    SELECT DISTINCT ct.tid, cta.child_id
    FROM club_teams ct
    JOIN public.child_team_assignments cta ON cta.team_id = ct.tid
  ),
  windowed_user_pts AS (
    SELECT tmu.tid, COALESCE(SUM(GREATEST(ph.amount,0))::int,0) AS pts
    FROM team_member_users tmu
    LEFT JOIN public.points_history ph
      ON ph.user_id = tmu.uid
     AND ph.club_id = _club_id
     AND ph.created_at >= _start
    GROUP BY tmu.tid
  ),
  windowed_child_pts AS (
    SELECT tmc.tid, COALESCE(SUM(GREATEST(ph.amount,0))::int,0) AS pts
    FROM team_member_children tmc
    LEFT JOIN public.points_history ph
      ON ph.child_id = tmc.child_id
     AND ph.club_id = _club_id
     AND ph.created_at >= _start
    GROUP BY tmc.tid
  ),
  alltime_user_pts AS (
    SELECT tmu.tid, COALESCE(SUM(p.ignite_points)::int,0) AS pts
    FROM team_member_users tmu
    LEFT JOIN public.profiles p ON p.id = tmu.uid
    GROUP BY tmu.tid
  ),
  alltime_child_pts AS (
    SELECT tmc.tid, COALESCE(SUM(c.ignite_points)::int,0) AS pts
    FROM team_member_children tmc
    LEFT JOIN public.children c ON c.id = tmc.child_id
    GROUP BY tmc.tid
  ),
  totals AS (
    SELECT ct.tid, ct.tname,
      CASE WHEN _is_all_time
        THEN COALESCE(aup.pts,0) + COALESCE(acp.pts,0)
        ELSE COALESCE(wup.pts,0) + COALESCE(wcp.pts,0)
      END AS pts
    FROM club_teams ct
    LEFT JOIN windowed_user_pts wup ON wup.tid = ct.tid
    LEFT JOIN windowed_child_pts wcp ON wcp.tid = ct.tid
    LEFT JOIN alltime_user_pts aup ON aup.tid = ct.tid
    LEFT JOIN alltime_child_pts acp ON acp.tid = ct.tid
  ),
  ranked AS (
    SELECT t.tid, t.tname, t.pts,
      RANK() OVER (ORDER BY t.pts DESC) AS r
    FROM totals t
    WHERE t.pts > 0
  )
  SELECT r.r::int, r.tid, r.tname, r.pts
  FROM ranked r
  WHERE r.r <= _limit
  ORDER BY r.r ASC, r.tname ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_teams_leaderboard(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_teams_leaderboard(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_teams_leaderboard(uuid, text, integer) TO authenticated;