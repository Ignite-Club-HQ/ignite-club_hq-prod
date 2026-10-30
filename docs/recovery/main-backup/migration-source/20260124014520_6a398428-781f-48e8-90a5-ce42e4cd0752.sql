-- Make team_id nullable to allow club-level folders (folders that belong to a club but not a specific team)
ALTER TABLE public.team_folders 
ALTER COLUMN team_id DROP NOT NULL;