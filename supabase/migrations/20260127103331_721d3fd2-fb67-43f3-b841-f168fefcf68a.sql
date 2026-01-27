-- Add team_size_override column to mini_league_sessions
-- This allows overriding the default team_size from the mini_league for individual sessions
ALTER TABLE public.mini_league_sessions 
ADD COLUMN team_size_override integer DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.mini_league_sessions.team_size_override IS 'Optional override for players per side for this specific session. If NULL, uses the mini_league default.';