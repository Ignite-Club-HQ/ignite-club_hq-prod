
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS playhq_team_id text,
  ADD COLUMN IF NOT EXISTS playhq_competition_id uuid REFERENCES public.competitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS playhq_auto_create_events boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_teams_playhq_competition
  ON public.teams(playhq_competition_id)
  WHERE playhq_competition_id IS NOT NULL;
