
-- All-time leaderboard rank for a user within a single club, using profiles.ignite_points.
-- SECURITY DEFINER so the rank is computed against the FULL set of club members,
-- bypassing per-viewer RLS that could otherwise hide higher-ranked users and make
-- the viewer falsely appear at rank 1 (the bug Lauren reported).

CREATE OR REPLACE FUNCTION public.get_user_leaderboard_rank_all_time(
  _user_id uuid,
  _club_id uuid
)
RETURNS TABLE (rank int, total int, points int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH club_members AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.club_id = _club_id AND ur.user_id IS NOT NULL
    UNION
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.teams t ON t.id = ur.team_id
    WHERE t.club_id = _club_id AND ur.user_id IS NOT NULL
  ),
  scored AS (
    SELECT cm.user_id,
           COALESCE(p.ignite_points, 0)::int AS pts
    FROM club_members cm
    LEFT JOIN public.profiles p ON p.id = cm.user_id
  ),
  ranked AS (
    SELECT user_id, pts,
           RANK() OVER (ORDER BY pts DESC) AS r,
           COUNT(*) OVER () AS n
    FROM scored
  )
  SELECT r::int, n::int, pts
  FROM ranked
  WHERE user_id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_leaderboard_rank_all_time(uuid, uuid) TO authenticated;
