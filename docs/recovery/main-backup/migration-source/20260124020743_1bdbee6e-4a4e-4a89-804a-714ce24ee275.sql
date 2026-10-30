-- Drop the incorrect foreign key constraint that references vault_folders
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_folder_id_fkey;

-- Add the correct foreign key constraint to reference team_folders
ALTER TABLE public.teams
ADD CONSTRAINT teams_folder_id_fkey
FOREIGN KEY (folder_id) REFERENCES public.team_folders(id) ON DELETE SET NULL;