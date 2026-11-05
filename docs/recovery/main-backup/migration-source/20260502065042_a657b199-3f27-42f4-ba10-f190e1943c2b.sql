-- Fix seasoned rank RPC to roll up children's points under their guardian,
-- matching the behavior of get_user_leaderboard_rank_all_time and the
-- leaderboard RPCs.

CREATE OR REPLACE FUNCTION public.get_user_leaderboard_rank_seasoned(
  _user_id uuid,
  _club_id uuid,
  _season_id uuid
) RETURNS TABLE (rank int, total int, points int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _season_filter uuid := _season_id;
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
  totals AS (
    SELECT cm.user_id,
           COALESCE((
             SELECT SUM(GREATEST(ph.amount, 0))::int
             FROM public.points_history ph
             WHERE ph.club_id = _club_id
               AND (_season_filter IS NULL OR ph.season_id = _season_filter)
               AND (
                 ph.user_id = cm.user_id
                 OR ph.child_id IN (
                   SELECT c.id FROM public.children c WHERE c.parent_id = cm.user_id
                 )
               )
           ), 0) AS pts
    FROM club_members cm
  ),
  ranked AS (
    SELECT user_id, pts,
           RANK() OVER (ORDER BY pts DESC) AS r,
           COUNT(*) OVER () AS n
    FROM totals
  )
  SELECT r::int, n::int, pts
  FROM ranked
  WHERE user_id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_leaderboard_rank_seasoned(uuid, uuid, uuid) TO authenticated;