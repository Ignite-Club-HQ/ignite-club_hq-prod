DROP FUNCTION IF EXISTS public.get_club_leaderboard(uuid, text, uuid, integer);
DROP FUNCTION IF EXISTS public.get_team_leaderboard(uuid, text, uuid, integer);

CREATE OR REPLACE FUNCTION public.get_club_leaderboard(
  _club_id uuid,
  _window text,
  _viewer_id uuid,
  _limit integer
) RETURNS TABLE (
  rank int,
  user_id uuid,
  display_name text,
  avatar_url text,
  points int,
  is_viewer boolean,
  hidden boolean
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
  WITH club_users AS (
    SELECT DISTINCT ur.user_id AS uid
    FROM public.user_roles ur
    WHERE ur.club_id = _club_id AND ur.user_id IS NOT NULL

    UNION

    SELECT DISTINCT ur.user_id AS uid
    FROM public.user_roles ur
    JOIN public.teams t ON t.id = ur.team_id
    WHERE t.club_id = _club_id AND ur.user_id IS NOT NULL

    UNION

    SELECT DISTINCT c.parent_id AS uid
    FROM public.child_team_assignments cta
    JOIN public.teams t ON t.id = cta.team_id
    JOIN public.children c ON c.id = cta.child_id
    WHERE t.club_id = _club_id AND c.parent_id IS NOT NULL

    UNION

    SELECT DISTINCT cg.guardian_id AS uid
    FROM public.child_team_assignments cta
    JOIN public.teams t ON t.id = cta.team_id
    JOIN public.child_guardians cg ON cg.child_id = cta.child_id
    WHERE t.club_id = _club_id AND cg.guardian_id IS NOT NULL
  ),
  windowed AS (
    SELECT cu.uid,
      COALESCE((
        SELECT SUM(GREATEST(ph.amount,0))::int
        FROM public.points_history ph
        WHERE ph.club_id = _club_id
          AND ph.created_at >= _start
          AND (
            ph.user_id = cu.uid
            OR ph.child_id IN (
              SELECT c.id FROM public.children c WHERE c.parent_id = cu.uid
              UNION
              SELECT cg.child_id FROM public.child_guardians cg WHERE cg.guardian_id = cu.uid
            )
          )
      ), 0) AS pts
    FROM club_users cu
  ),
  alltime AS (
    SELECT cu.uid,
      COALESCE(p.ignite_points,0)
        + COALESCE((
          SELECT SUM(c.ignite_points)::int
          FROM public.children c
          WHERE c.parent_id = cu.uid
             OR c.id IN (SELECT cg.child_id FROM public.child_guardians cg WHERE cg.guardian_id = cu.uid)
        ), 0) AS pts
    FROM club_users cu
    LEFT JOIN public.profiles p ON p.id = cu.uid
  ),
  scored AS (
    SELECT cu.uid,
      CASE WHEN _is_all_time THEN at.pts ELSE w.pts END AS pts
    FROM club_users cu
    LEFT JOIN windowed w ON w.uid = cu.uid
    LEFT JOIN alltime at ON at.uid = cu.uid
  ),
  joined AS (
    SELECT s.uid, s.pts,
      p.display_name, p.avatar_url,
      COALESCE(p.leaderboard_opt_out, false) AS opted_out
    FROM scored s
    LEFT JOIN public.profiles p ON p.id = s.uid
  ),
  visible AS (
    SELECT * FROM joined
    WHERE pts > 0 AND (NOT opted_out OR uid = _viewer_id)
  ),
  ranked AS (
    SELECT v.uid, v.display_name, v.avatar_url, v.pts, v.opted_out,
      RANK() OVER (ORDER BY v.pts DESC) AS r
    FROM visible v
  )
  SELECT r.r::int,
    r.uid,
    r.display_name,
    r.avatar_url,
    r.pts,
    (r.uid = _viewer_id),
    r.opted_out
  FROM ranked r
  WHERE r.r <= _limit OR r.uid = _viewer_id
  ORDER BY r.r ASC, r.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_team_leaderboard(
  _team_id uuid,
  _window text,
  _viewer_id uuid,
  _limit integer
) RETURNS TABLE (
  rank int,
  user_id uuid,
  display_name text,
  avatar_url text,
  points int,
  is_viewer boolean,
  hidden boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start timestamptz;
  _is_all_time boolean := (_window = 'all');
  _club_id uuid;
BEGIN
  SELECT t.club_id INTO _club_id FROM public.teams t WHERE t.id = _team_id;

  IF _window = 'week' THEN
    _start := date_trunc('week', now());
  ELSIF _window = 'month' THEN
    _start := date_trunc('month', now());
  ELSE
    _start := '1900-01-01'::timestamptz;
  END IF;

  RETURN QUERY
  WITH team_users AS (
    SELECT DISTINCT ur.user_id AS uid
    FROM public.user_roles ur
    WHERE ur.team_id = _team_id AND ur.user_id IS NOT NULL

    UNION

    SELECT DISTINCT c.parent_id AS uid
    FROM public.child_team_assignments cta
    JOIN public.children c ON c.id = cta.child_id
    WHERE cta.team_id = _team_id AND c.parent_id IS NOT NULL

    UNION

    SELECT DISTINCT cg.guardian_id AS uid
    FROM public.child_team_assignments cta
    JOIN public.child_guardians cg ON cg.child_id = cta.child_id
    WHERE cta.team_id = _team_id AND cg.guardian_id IS NOT NULL
  ),
  team_children AS (
    SELECT DISTINCT cta.child_id
    FROM public.child_team_assignments cta
    WHERE cta.team_id = _team_id
  ),
  windowed AS (
    SELECT tu.uid,
      COALESCE((
        SELECT SUM(GREATEST(ph.amount,0))::int
        FROM public.points_history ph
        WHERE ph.club_id = _club_id
          AND ph.created_at >= _start
          AND (
            ph.user_id = tu.uid
            OR ph.child_id IN (
              SELECT tc.child_id
              FROM team_children tc
              JOIN public.children c ON c.id = tc.child_id
              WHERE c.parent_id = tu.uid
              UNION
              SELECT tc.child_id
              FROM team_children tc
              JOIN public.child_guardians cg ON cg.child_id = tc.child_id
              WHERE cg.guardian_id = tu.uid
            )
          )
      ), 0) AS pts
    FROM team_users tu
  ),
  alltime AS (
    SELECT tu.uid,
      COALESCE(p.ignite_points,0)
        + COALESCE((
            SELECT SUM(c.ignite_points)::int
            FROM team_children tc
            JOIN public.children c ON c.id = tc.child_id
            WHERE c.parent_id = tu.uid
               OR c.id IN (SELECT cg.child_id FROM public.child_guardians cg WHERE cg.guardian_id = tu.uid)
          ), 0) AS pts
    FROM team_users tu
    LEFT JOIN public.profiles p ON p.id = tu.uid
  ),
  scored AS (
    SELECT tu.uid,
      CASE WHEN _is_all_time THEN at.pts ELSE w.pts END AS pts
    FROM team_users tu
    LEFT JOIN windowed w ON w.uid = tu.uid
    LEFT JOIN alltime at ON at.uid = tu.uid
  ),
  joined AS (
    SELECT s.uid, s.pts,
      p.display_name, p.avatar_url,
      COALESCE(p.leaderboard_opt_out, false) AS opted_out
    FROM scored s
    LEFT JOIN public.profiles p ON p.id = s.uid
  ),
  visible AS (
    SELECT * FROM joined
    WHERE pts > 0 AND (NOT opted_out OR uid = _viewer_id)
  ),
  ranked AS (
    SELECT v.uid, v.display_name, v.avatar_url, v.pts, v.opted_out,
      RANK() OVER (ORDER BY v.pts DESC) AS r
    FROM visible v
  )
  SELECT r.r::int,
    r.uid,
    r.display_name,
    r.avatar_url,
    r.pts,
    (r.uid = _viewer_id),
    r.opted_out
  FROM ranked r
  WHERE r.r <= _limit OR r.uid = _viewer_id
  ORDER BY r.r ASC, r.display_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_club_leaderboard(uuid, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(uuid, text, uuid, integer) TO authenticated;