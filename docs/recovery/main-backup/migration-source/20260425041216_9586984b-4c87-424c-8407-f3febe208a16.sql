-- Read access for vault_files: any user with any role in the same club/team can view
CREATE POLICY "Club members can view club vault files"
ON public.vault_files
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.club_id = vault_files.club_id
        OR ur.club_id IN (SELECT t.club_id FROM public.teams t WHERE t.id = vault_files.team_id)
      )
  )
);

CREATE POLICY "Team members can view team vault files"
ON public.vault_files
FOR SELECT
USING (
  vault_files.team_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.team_id = vault_files.team_id
  )
);

-- Read access for vault_folders (so the folder tree renders)
CREATE POLICY "Club members can view club vault folders"
ON public.vault_folders
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (
        ur.club_id = vault_folders.club_id
        OR ur.club_id IN (SELECT t.club_id FROM public.teams t WHERE t.id = vault_folders.team_id)
      )
  )
);

CREATE POLICY "Team members can view team vault folders"
ON public.vault_folders
FOR SELECT
USING (
  vault_folders.team_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.team_id = vault_folders.team_id
  )
);