-- Drop existing vault policies
DROP POLICY IF EXISTS "Admins can manage vault files" ON public.vault_files;
DROP POLICY IF EXISTS "Users can view files in accessible folders" ON public.vault_files;
DROP POLICY IF EXISTS "League admins can manage vault files" ON public.vault_files;
DROP POLICY IF EXISTS "Admins can manage vault folders" ON public.vault_folders;
DROP POLICY IF EXISTS "Members can view vault folders" ON public.vault_folders;

-- Create new vault_files policies

-- 1. Club admins and committee members can manage ALL files in their club
CREATE POLICY "Club admins and committee can manage club vault files"
ON public.vault_files
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('club_admin', 'committee_member', 'app_admin')
    AND (
      -- Direct club files
      ur.club_id = vault_files.club_id
      -- Team files (club admin/committee can access all teams in their club)
      OR ur.club_id IN (SELECT t.club_id FROM teams t WHERE t.id = vault_files.team_id)
      -- Files in folders - check folder's club/team association
      OR (vault_files.folder_id IS NOT NULL AND ur.club_id IN (
        SELECT COALESCE(vf.club_id, t.club_id)
        FROM vault_folders vf
        LEFT JOIN teams t ON t.id = vf.team_id
        WHERE vf.id = vault_files.folder_id
      ))
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('club_admin', 'committee_member', 'app_admin')
    AND (
      ur.club_id = vault_files.club_id
      OR ur.club_id IN (SELECT t.club_id FROM teams t WHERE t.id = vault_files.team_id)
      OR (vault_files.folder_id IS NOT NULL AND ur.club_id IN (
        SELECT COALESCE(vf.club_id, t.club_id)
        FROM vault_folders vf
        LEFT JOIN teams t ON t.id = vf.team_id
        WHERE vf.id = vault_files.folder_id
      ))
    )
  )
);

-- 2. Team admins and coaches can manage their team's files only
CREATE POLICY "Team admins and coaches can manage team vault files"
ON public.vault_files
FOR ALL
USING (
  vault_files.team_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.team_id = vault_files.team_id
    AND ur.role IN ('team_admin', 'coach')
  )
  OR (
    vault_files.folder_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM vault_folders vf
      JOIN user_roles ur ON ur.team_id = vf.team_id
      WHERE vf.id = vault_files.folder_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('team_admin', 'coach')
    )
  )
)
WITH CHECK (
  vault_files.team_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.team_id = vault_files.team_id
    AND ur.role IN ('team_admin', 'coach')
  )
  OR (
    vault_files.folder_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM vault_folders vf
      JOIN user_roles ur ON ur.team_id = vf.team_id
      WHERE vf.id = vault_files.folder_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('team_admin', 'coach')
    )
  )
);

-- 3. League admins can manage mini-league vault files
CREATE POLICY "League admins can manage mini league vault files"
ON public.vault_files
FOR ALL
USING (
  vault_files.mini_league_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN mini_leagues ml ON ml.club_id = ur.club_id
    WHERE ml.id = vault_files.mini_league_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('league_admin', 'club_admin', 'app_admin')
  )
)
WITH CHECK (
  vault_files.mini_league_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN mini_leagues ml ON ml.club_id = ur.club_id
    WHERE ml.id = vault_files.mini_league_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('league_admin', 'club_admin', 'app_admin')
  )
);

-- Create new vault_folders policies

-- 1. Club admins and committee members can manage ALL folders in their club
CREATE POLICY "Club admins and committee can manage club vault folders"
ON public.vault_folders
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('club_admin', 'committee_member', 'app_admin')
    AND (
      ur.club_id = vault_folders.club_id
      OR ur.club_id IN (SELECT t.club_id FROM teams t WHERE t.id = vault_folders.team_id)
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('club_admin', 'committee_member', 'app_admin')
    AND (
      ur.club_id = vault_folders.club_id
      OR ur.club_id IN (SELECT t.club_id FROM teams t WHERE t.id = vault_folders.team_id)
    )
  )
);

-- 2. Team admins and coaches can manage their team's folders only
CREATE POLICY "Team admins and coaches can manage team vault folders"
ON public.vault_folders
FOR ALL
USING (
  vault_folders.team_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.team_id = vault_folders.team_id
    AND ur.role IN ('team_admin', 'coach')
  )
)
WITH CHECK (
  vault_folders.team_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.team_id = vault_folders.team_id
    AND ur.role IN ('team_admin', 'coach')
  )
);