ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS hide_ladder boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW public.competition_ladder WITH (security_invoker=true) AS
WITH per_team AS (
  SELECT m.competition_id, COALESCE(e.division_id, m.division_id) AS division_id, m.home_team_id AS team_id, 1 AS played,
    CASE WHEN m.home_score > m.away_score THEN 1 ELSE 0 END AS wins,
    CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END AS draws,
    CASE WHEN m.home_score < m.away_score THEN 1 ELSE 0 END AS losses,
    COALESCE(m.home_score, 0) AS goals_for, COALESCE(m.away_score, 0) AS goals_against
  FROM competition_matches m
  LEFT JOIN competition_entries e ON e.competition_id = m.competition_id AND e.team_id = m.home_team_id
  WHERE m.status = 'completed' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND m.home_team_id IS NOT NULL
  UNION ALL
  SELECT m.competition_id, COALESCE(e.division_id, m.division_id), m.away_team_id, 1,
    CASE WHEN m.away_score > m.home_score THEN 1 ELSE 0 END,
    CASE WHEN m.away_score = m.home_score THEN 1 ELSE 0 END,
    CASE WHEN m.away_score < m.home_score THEN 1 ELSE 0 END,
    COALESCE(m.away_score, 0), COALESCE(m.home_score, 0)
  FROM competition_matches m
  LEFT JOIN competition_entries e ON e.competition_id = m.competition_id AND e.team_id = m.away_team_id
  WHERE m.status = 'completed' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND m.away_team_id IS NOT NULL
)
SELECT pt.competition_id, pt.division_id, pt.team_id,
  sum(pt.played)::integer AS played, sum(pt.wins)::integer AS wins, sum(pt.draws)::integer AS draws,
  sum(pt.losses)::integer AS losses, sum(pt.goals_for)::integer AS goals_for,
  sum(pt.goals_against)::integer AS goals_against,
  (sum(pt.goals_for) - sum(pt.goals_against))::integer AS goal_diff,
  (sum(pt.wins) * COALESCE(max(c.points_win), 3) + sum(pt.draws) * COALESCE(max(c.points_draw), 1) + sum(pt.losses) * COALESCE(max(c.points_loss), 0))::integer AS points
FROM per_team pt
JOIN competitions c ON c.id = pt.competition_id
WHERE is_competition_admin(auth.uid(), pt.competition_id)
   OR (NOT c.hide_ladder AND NOT EXISTS (
        SELECT 1 FROM competition_divisions hd
        WHERE hd.competition_id = pt.competition_id AND hd.hide_ladder = true))
GROUP BY pt.competition_id, pt.division_id, pt.team_id;