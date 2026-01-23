-- Add team_type column to teams table
ALTER TABLE public.teams 
ADD COLUMN team_type text DEFAULT 'mixed' CHECK (team_type IN ('junior', 'senior', 'mixed'));

-- Add comment for clarity
COMMENT ON COLUMN public.teams.team_type IS 'Team classification: junior (kids only), senior (adults only), or mixed (both)';