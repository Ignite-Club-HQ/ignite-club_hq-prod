-- Opt-out flag
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS leaderboard_opt_out boolean NOT NULL DEFAULT false;

-- Helper: window start timestamp
CREATE OR REPLACE FUNCTION public._leaderboard_window_start(_window text)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(_window)
    WHEN 'week'  THEN date_trunc('week', now())
    WHEN 'month' THEN date_trunc('month', now())
    ELSE '-infinity'::timestamptz
  END;
$$;

-- ============ CLUB LEADERBOARD ============
CREATE OR REPLACE FUNCTION public.get_club_leaderboard(
  _club_id uuid,
  _window text DEFAULT 'all',
  _viewer_id uuid DEFAULT NULL,
  _limit integer DEFAULT 50
)
RETURNS TABLE (
  rank integer,
  user_id uuid,
  display_name text,
  avatar_url text,
  points integer,
  is_viewer boolean,
  hidden boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _start timestamptz := public._leaderboard_window_start(_window);
  _is_all_time boolean := lower(_window) NOT IN ('week','month');
BEGIN
  RETURN QUERY
  WITH club_users AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.club_id = _club_id AND ur.user_id IS NOT NULL
    UNION
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.teams t ON t.id = ur.team_id
    WHERE t.club_id = _club_id AND ur.user_id IS NOT NULL
  ),
  -- Window points from history: own + children's
  windowed AS (
    SELECT cu.user_id,
      COALESCE((
        SELECT SUM(GREATEST(ph.amount,0))::int
        FROM public.points_history ph
        WHERE ph.created_at >= _start
          AND (
            ph.user_id = cu.user_id
            OR ph.child_id IN (SELECT c.id FROM public.children c WHERE c.parent_id = cu.user_id)
          )
      ), 0) AS pts
    FROM club_users cu
  ),
  -- All-time points: profile balance + children balances
  alltime AS (
    SELECT cu.user_id,
      COALESCE(p.ignite_points,0)
        + COALESCE((SELECT SUM(c.ignite_points)::int FROM public.children c WHERE c.parent_id = cu.user_id), 0)
        AS pts
    FROM club_users cu
    LEFT JOIN public.profiles p ON p.id = cu.user_id
  ),
  scored AS (
    SELECT cu.user_id,
      CASE WHEN _is_all_time THEN at.pts ELSE w.pts END AS pts
    FROM club_users cu
    LEFT JOIN windowed w ON w.user_id = cu.user_id
    LEFT JOIN alltime at ON at.user_id = cu.user_id
  ),
  joined AS (
    SELECT s.user_id, s.pts,
      p.display_name, p.avatar_url,
      COALESCE(p.leaderboard_opt_out, false) AS opted_out
    FROM scored s
    LEFT JOIN public.profiles p ON p.id = s.user_id
  ),
  visible AS (
    SELECT * FROM joined
    WHERE NOT opted_out OR user_id = _viewer_id
  ),
  ranked AS (
    SELECT user_id, display_name, avatar_url, pts, opted_out,
      RANK() OVER (ORDER BY pts DESC) AS r
    FROM visible
  )
  SELECT r::int AS rank,
    user_id,
    display_name,
    avatar_url,
    pts AS points,
    (user_id = _viewer_id) AS is_viewer,
    opted_out AS hidden
  FROM ranked
  WHERE r <= _limit OR user_id = _viewer_id
  ORDER BY r ASC, display_name ASC;
END;
$$;

-- ============ TEAM LEADERBOARD ============
CREATE OR REPLACE FUNCTION public.get_team_leaderboard(
  _team_id uuid,
  _window text DEFAULT 'all',
  _viewer_id uuid DEFAULT NULL,
  _limit integer DEFAULT 50
)
RETURNS TABLE (
  rank integer,
  user_id uuid,
  display_name text,
  avatar_url text,
  points integer,
  is_viewer boolean,
  hidden boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _start timestamptz := public._leaderboard_window_start(_window);
  _is_all_time boolean := lower(_window) NOT IN ('week','month');
BEGIN
  RETURN QUERY
  WITH team_users AS (
    -- Direct user roles on this team
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.team_id = _team_id AND ur.user_id IS NOT NULL
    UNION
    -- Parents of children assigned to this team
    SELECT DISTINCT c.parent_id AS user_id
    FROM public.child_team_assignments cta
    JOIN public.children c ON c.id = cta.child_id
    WHERE cta.team_id = _team_id AND c.parent_id IS NOT NULL
  ),
  windowed AS (
    SELECT tu.user_id,
      COALESCE((
        SELECT SUM(GREATEST(ph.amount,0))::int
        FROM public.points_history ph
        WHERE ph.created_at >= _start
          AND (
            ph.user_id = tu.user_id
            OR ph.child_id IN (SELECT c.id FROM public.children c WHERE c.parent_id = tu.user_id)
          )
      ), 0) AS pts
    FROM team_users tu
  ),
  alltime AS (
    SELECT tu.user_id,
      COALESCE(p.ignite_points,0)
        + COALESCE((SELECT SUM(c.ignite_points)::int FROM public.children c WHERE c.parent_id = tu.user_id), 0)
        AS pts
    FROM team_users tu
    LEFT JOIN public.profiles p ON p.id = tu.user_id
  ),
  scored AS (
    SELECT tu.user_id,
      CASE WHEN _is_all_time THEN at.pts ELSE w.pts END AS pts
    FROM team_users tu
    LEFT JOIN windowed w ON w.user_id = tu.user_id
    LEFT JOIN alltime at ON at.user_id = tu.user_id
  ),
  joined AS (
    SELECT s.user_id, s.pts,
      p.display_name, p.avatar_url,
      COALESCE(p.leaderboard_opt_out, false) AS opted_out
    FROM scored s
    LEFT JOIN public.profiles p ON p.id = s.user_id
  ),
  visible AS (
    SELECT * FROM joined
    WHERE NOT opted_out OR user_id = _viewer_id
  ),
  ranked AS (
    SELECT user_id, display_name, avatar_url, pts, opted_out,
      RANK() OVER (ORDER BY pts DESC) AS r
    FROM visible
  )
  SELECT r::int AS rank,
    user_id,
    display_name,
    avatar_url,
    pts AS points,
    (user_id = _viewer_id) AS is_viewer,
    opted_out AS hidden
  FROM ranked
  WHERE r <= _limit OR user_id = _viewer_id
  ORDER BY r ASC, display_name ASC;
END;
$$;

-- Helper: which teams in a club can a viewer see for the team selector?
CREATE OR REPLACE FUNCTION public.list_leaderboard_teams(_club_id uuid)
RETURNS TABLE (id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.id, t.name
  FROM public.teams t
  WHERE t.club_id = _club_id
  ORDER BY t.name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_club_leaderboard(uuid, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(uuid, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_leaderboard_teams(uuid) TO authenticated;