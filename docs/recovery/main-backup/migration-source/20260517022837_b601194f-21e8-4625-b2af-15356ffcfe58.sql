
-- Matches
CREATE TABLE public.competition_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  division_id UUID NULL REFERENCES public.competition_divisions(id) ON DELETE SET NULL,
  round_number INT NULL,
  home_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  away_team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NULL,
  venue TEXT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  home_score INT NULL,
  away_score INT NULL,
  notes TEXT NULL,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT competition_matches_status_check CHECK (status IN ('scheduled','in_progress','completed','postponed','cancelled')),
  CONSTRAINT competition_matches_teams_check CHECK (home_team_id <> away_team_id)
);

CREATE INDEX idx_competition_matches_comp ON public.competition_matches(competition_id, scheduled_at);
CREATE INDEX idx_competition_matches_division ON public.competition_matches(division_id);
CREATE INDEX idx_competition_matches_home ON public.competition_matches(home_team_id);
CREATE INDEX idx_competition_matches_away ON public.competition_matches(away_team_id);

CREATE TRIGGER update_competition_matches_updated_at
BEFORE UPDATE ON public.competition_matches
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.competition_matches ENABLE ROW LEVEL SECURITY;

-- Helper: is user a referee/scorer for this match's competition?
CREATE OR REPLACE FUNCTION public.is_competition_official(_user_id uuid, _competition_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.competition_roles cr
    WHERE cr.competition_id = _competition_id
      AND cr.user_id = _user_id
      AND cr.role IN ('referee','scorer','owner','admin')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_competition_official(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_competition_official(uuid, uuid) TO authenticated;

-- View policies
CREATE POLICY "View matches if can view competition"
ON public.competition_matches
FOR SELECT
TO authenticated
USING (public.can_view_competition(auth.uid(), competition_id));

CREATE POLICY "Public can view matches of public competitions"
ON public.competition_matches
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.id = competition_matches.competition_id
      AND c.visibility = 'public'
  )
);

-- Write policies
CREATE POLICY "Admins can insert matches"
ON public.competition_matches
FOR INSERT TO authenticated
WITH CHECK (public.is_competition_admin(auth.uid(), competition_id));

CREATE POLICY "Admins can delete matches"
ON public.competition_matches
FOR DELETE TO authenticated
USING (public.is_competition_admin(auth.uid(), competition_id));

CREATE POLICY "Admins can update matches"
ON public.competition_matches
FOR UPDATE TO authenticated
USING (public.is_competition_admin(auth.uid(), competition_id))
WITH CHECK (public.is_competition_admin(auth.uid(), competition_id));

CREATE POLICY "Officials can update score and status"
ON public.competition_matches
FOR UPDATE TO authenticated
USING (public.is_competition_official(auth.uid(), competition_id))
WITH CHECK (public.is_competition_official(auth.uid(), competition_id));

-- Allow anon/auth to view public competitions
CREATE POLICY "Anyone can view public competitions"
ON public.competitions
FOR SELECT
TO anon, authenticated
USING (visibility = 'public');

-- Ladder view (per team per division, completed matches only)
CREATE OR REPLACE VIEW public.competition_ladder AS
WITH per_team AS (
  SELECT
    m.competition_id,
    m.division_id,
    m.home_team_id AS team_id,
    1 AS played,
    CASE WHEN m.home_score > m.away_score THEN 1 ELSE 0 END AS wins,
    CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END AS draws,
    CASE WHEN m.home_score < m.away_score THEN 1 ELSE 0 END AS losses,
    COALESCE(m.home_score, 0) AS goals_for,
    COALESCE(m.away_score, 0) AS goals_against
  FROM public.competition_matches m
  WHERE m.status = 'completed' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
  UNION ALL
  SELECT
    m.competition_id,
    m.division_id,
    m.away_team_id AS team_id,
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
  competition_id,
  division_id,
  team_id,
  SUM(played)::int AS played,
  SUM(wins)::int AS wins,
  SUM(draws)::int AS draws,
  SUM(losses)::int AS losses,
  SUM(goals_for)::int AS goals_for,
  SUM(goals_against)::int AS goals_against,
  (SUM(goals_for) - SUM(goals_against))::int AS goal_diff,
  (SUM(wins) * 3 + SUM(draws))::int AS points
FROM per_team
GROUP BY competition_id, division_id, team_id;

GRANT SELECT ON public.competition_ladder TO anon, authenticated;
