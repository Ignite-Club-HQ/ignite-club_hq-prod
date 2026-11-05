-- Add mini_league_id column to vault_files table
ALTER TABLE public.vault_files 
ADD COLUMN mini_league_id uuid REFERENCES public.mini_leagues(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX idx_vault_files_mini_league_id ON public.vault_files(mini_league_id);

-- Update RLS policies to include mini-league access
CREATE POLICY "League admins can manage vault files" ON public.vault_files
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
    WHERE ml.id = mini_league_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('league_admin', 'coach', 'club_admin', 'app_admin')
  )
);