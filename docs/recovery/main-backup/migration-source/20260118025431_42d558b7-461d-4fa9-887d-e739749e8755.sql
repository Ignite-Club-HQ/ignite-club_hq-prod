-- Delete the older duplicate Tangerinas team
DELETE FROM teams WHERE id = 'eda72f44-5a1e-43a9-a63c-dbf2f8a3fb2e';

-- Add unique constraint to prevent duplicate team names within the same club
CREATE UNIQUE INDEX idx_unique_team_name_per_club ON public.teams (club_id, lower(name));