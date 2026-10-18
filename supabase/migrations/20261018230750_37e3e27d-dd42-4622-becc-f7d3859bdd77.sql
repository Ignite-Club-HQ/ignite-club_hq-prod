DROP VIEW public.competition_ladder;

CREATE VIEW public.competition_ladder AS
WITH per_team AS (
  SELECT m.competition_id,
         COALESCE(e.division_id, m.division_id) AS division_id,
         m.home_team_id AS team_id,
         1 AS played,
         CASE WHEN r.home_score > r.away_score THEN 1 ELSE 0 END AS wins,
         CASE WHEN r.home_score = r.away_score THEN 1 ELSE 0 END AS draws,
         CASE WHEN r.home_score < r.away_score THEN 1 ELSE 0 END AS losses,
         COALESCE(r.home_score, 0) AS goals_for,
         COALESCE(r.away_score, 0) AS goals_against
    FROM public.competition_matches m
    JOIN public.competition_match_results r ON r.match_id = m.id
    LEFT JOIN public.competition_entries e ON e.competition_id = m.competition_id AND e.team_id = m.home_team_id
   WHERE m.status = 'completed' AND r.home_score IS NOT NULL AND r.away_score IS NOT NULL AND m.home_team_id IS NOT NULL
     AND (NOT public.match_scores_hidden(m.id) OR public.is_competition_admin(auth.uid(), m.competition_id))
  UNION ALL
  SELECT m.competition_id,
         COALESCE(e.division_id, m.division_id) AS division_id,
         m.away_team_id,
         1,
         CASE WHEN r.away_score > r.home_score THEN 1 ELSE 0 END,
         CASE WHEN r.away_score = r.home_score THEN 1 ELSE 0 END,
         CASE WHEN r.away_score < r.home_score THEN 1 ELSE 0 END,
         COALESCE(r.away_score, 0),
         COALESCE(r.home_score, 0)
    FROM public.competition_matches m
    JOIN public.competition_match_results r ON r.match_id = m.id
    LEFT JOIN public.competition_entries e ON e.competition_id = m.competition_id AND e.team_id = m.away_team_id
   WHERE m.status = 'completed' AND r.home_score IS NOT NULL AND r.away_score IS NOT NULL AND m.away_team_id IS NOT NULL
     AND (NOT public.match_scores_hidden(m.id) OR public.is_competition_admin(auth.uid(), m.competition_id))
)
SELECT pt.competition_id,
       pt.division_id,
       pt.team_id,
       sum(pt.played)::integer AS played,
       sum(pt.wins)::integer AS wins,
       sum(pt.draws)::integer AS draws,
       sum(pt.losses)::integer AS losses,
       sum(pt.goals_for)::integer AS goals_for,
       sum(pt.goals_against)::integer AS goals_against,
       (sum(pt.goals_for) - sum(pt.goals_against))::integer AS goal_diff,
       ((sum(pt.wins) * COALESCE(max(c.points_win), 3)) + (sum(pt.draws) * COALESCE(max(c.points_draw), 1)) + (sum(pt.losses) * COALESCE(max(c.points_loss), 0)))::integer AS points
  FROM per_team pt
  JOIN public.competitions c ON c.id = pt.competition_id
 WHERE (public.is_competition_admin(auth.uid(), pt.competition_id)
    OR (NOT c.hide_ladder AND NOT EXISTS (
      SELECT 1 FROM public.competition_divisions hd
       WHERE hd.competition_id = pt.competition_id AND hd.hide_ladder = true)))
 GROUP BY pt.competition_id, pt.division_id, pt.team_id;

GRANT SELECT ON public.competition_ladder TO anon;
GRANT SELECT ON public.competition_ladder TO authenticated;
GRANT SELECT ON public.competition_ladder TO service_role;