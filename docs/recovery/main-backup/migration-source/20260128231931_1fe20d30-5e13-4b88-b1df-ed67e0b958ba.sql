-- Drop existing policies
DROP POLICY IF EXISTS "Admins can manage vault files" ON vault_files;

-- Create updated policy that handles both folder-based and direct team/club file inserts
CREATE POLICY "Admins can manage vault files" ON vault_files
FOR ALL
USING (
  -- Files in folders - check folder access
  (folder_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM vault_folders vf
    JOIN user_roles ur ON ((ur.team_id = vf.team_id OR ur.club_id = vf.club_id) 
      AND ur.role IN ('team_admin', 'coach', 'club_admin'))
    WHERE vf.id = vault_files.folder_id AND ur.user_id = auth.uid()
  ))
  OR
  -- Files without folders - check direct team/club access
  (folder_id IS NULL AND (
    -- Team files
    (vault_files.team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM user_roles ur 
      WHERE ur.team_id = vault_files.team_id 
        AND ur.user_id = auth.uid()
        AND ur.role IN ('team_admin', 'coach', 'club_admin')
    ))
    OR
    -- Club files (no team)
    (vault_files.team_id IS NULL AND vault_files.club_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM user_roles ur 
      WHERE ur.club_id = vault_files.club_id 
        AND ur.user_id = auth.uid()
        AND ur.role IN ('team_admin', 'coach', 'club_admin')
    ))
  ))
)
WITH CHECK (
  -- Files in folders - check folder access
  (folder_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM vault_folders vf
    JOIN user_roles ur ON ((ur.team_id = vf.team_id OR ur.club_id = vf.club_id) 
      AND ur.role IN ('team_admin', 'coach', 'club_admin'))
    WHERE vf.id = vault_files.folder_id AND ur.user_id = auth.uid()
  ))
  OR
  -- Files without folders - check direct team/club access
  (folder_id IS NULL AND (
    -- Team files
    (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM user_roles ur 
      WHERE ur.team_id = team_id 
        AND ur.user_id = auth.uid()
        AND ur.role IN ('team_admin', 'coach', 'club_admin')
    ))
    OR
    -- Club files (no team)
    (team_id IS NULL AND club_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM user_roles ur 
      WHERE ur.club_id = club_id 
        AND ur.user_id = auth.uid()
        AND ur.role IN ('team_admin', 'coach', 'club_admin')
    ))
  ))
);

-- Also update the SELECT policy to handle files without folders
DROP POLICY IF EXISTS "Users can view files in accessible folders" ON vault_files;

CREATE POLICY "Users can view files in accessible folders" ON vault_files
FOR SELECT
USING (
  -- Files in folders
  (folder_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM vault_folders vf
    LEFT JOIN user_roles ur ON (ur.team_id = vf.team_id OR ur.club_id = vf.club_id)
    WHERE vf.id = vault_files.folder_id AND ur.user_id = auth.uid()
  ))
  OR
  -- Files without folders - check direct access
  (folder_id IS NULL AND (
    (vault_files.team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM user_roles ur WHERE ur.team_id = vault_files.team_id AND ur.user_id = auth.uid()
    ))
    OR
    (vault_files.team_id IS NULL AND vault_files.club_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM user_roles ur WHERE ur.club_id = vault_files.club_id AND ur.user_id = auth.uid()
    ))
  ))
);