-- Add archive columns to teams table
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS season_label text;

-- Index for faster queries filtering active teams
CREATE INDEX IF NOT EXISTS idx_teams_is_archived ON public.teams(is_archived);
CREATE INDEX IF NOT EXISTS idx_teams_club_id_is_archived ON public.teams(club_id, is_archived);