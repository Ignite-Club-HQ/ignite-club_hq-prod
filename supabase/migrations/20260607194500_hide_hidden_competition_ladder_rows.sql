CREATE OR REPLACE VIEW public.competition_ladder
WITH (security_invoker = true)
AS
WITH per_team AS (
  SELECT m.competition_id, m.division_id, m.home_team_id AS team_id,
    1 AS played,
    CASE WHEN m.home_score > m.away_score THEN 1 ELSE 0 END AS wins,
    CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END AS draws,
    CASE WHEN m.home_score < m.away_score THEN 1 ELSE 0 END AS losses,
    COALESCE(m.home_score, 0) AS goals_for,
    COALESCE(m.away_score, 0) AS goals_against
  FROM public.competition_matches m
  WHERE m.status = 'completed' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
  UNION ALL
  SELECT m.competition_id, m.division_id, m.away_team_id AS team_id,
    1,
    CASE WHEN m.away_score > m.home_score THEN 1 ELSE 0 END,
    CASE WHEN m.away_score = m.home_score THEN 1 ELSE 0 END,
    CASE WHEN m.away_score < m.home_score THEN 1 ELSE 0 END,
    COALESCE(m.away_score, 0),
    COALESCE(m.home_score, 0)
  FROM public.competition_matches m
  WHERE m.status = 'completed' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
)
SELECT
  pt.competition_id,
  pt.division_id,
  pt.team_id,
  SUM(pt.played)::int AS played,
  SUM(pt.wins)::int AS wins,
  SUM(pt.draws)::int AS draws,
  SUM(pt.losses)::int AS losses,
  SUM(pt.goals_for)::int AS goals_for,
  SUM(pt.goals_against)::int AS goals_against,
  (SUM(pt.goals_for) - SUM(pt.goals_against))::int AS goal_diff,
  (SUM(pt.wins) * COALESCE(MAX(c.points_win), 3)
   + SUM(pt.draws) * COALESCE(MAX(c.points_draw), 1)
   + SUM(pt.losses) * COALESCE(MAX(c.points_loss), 0))::int AS points
FROM per_team pt
JOIN public.competitions c ON c.id = pt.competition_id
LEFT JOIN public.competition_divisions d ON d.id = pt.division_id
WHERE public.is_competition_admin(auth.uid(), pt.competition_id)
   OR (
     pt.division_id IS NOT NULL
     AND COALESCE(d.hide_ladder, false) = false
   )
   OR (
     pt.division_id IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.competition_divisions hidden_division
       WHERE hidden_division.competition_id = pt.competition_id
         AND hidden_division.hide_ladder = true
     )
   )
GROUP BY pt.competition_id, pt.division_id, pt.team_id;

GRANT SELECT ON public.competition_ladder TO authenticated, anon;
