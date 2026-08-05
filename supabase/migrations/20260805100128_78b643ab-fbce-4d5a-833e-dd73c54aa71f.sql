DROP INDEX IF EXISTS public.idx_unique_team_name_per_club;
CREATE UNIQUE INDEX idx_unique_team_name_per_club
  ON public.teams (club_id, lower(name))
  WHERE deleted_at IS NULL;