
-- Move team-specific vault files from club-level Chat folders to team-level Chat folders
DO $$
DECLARE
  r RECORD;
  target_folder_id UUID;
BEGIN
  -- Find all vault_files in Chat Images/Chat Links folders that have a team_id set
  -- but whose folder is club-level (team_id IS NULL on the folder)
  FOR r IN
    SELECT vf.id AS file_id, vf.club_id, vf.team_id, vf.uploaded_by, vfo.name AS folder_name
    FROM vault_files vf
    JOIN vault_folders vfo ON vf.folder_id = vfo.id
    WHERE vf.team_id IS NOT NULL
      AND vfo.name IN ('Chat Images', 'Chat Links')
      AND vfo.team_id IS NULL
  LOOP
    -- Check if a team-level folder already exists
    SELECT id INTO target_folder_id
    FROM vault_folders
    WHERE club_id = r.club_id
      AND team_id = r.team_id
      AND name = r.folder_name
      AND parent_id IS NULL
    LIMIT 1;

    -- Create it if not
    IF target_folder_id IS NULL THEN
      INSERT INTO vault_folders (club_id, team_id, name, created_by)
      VALUES (r.club_id, r.team_id, r.folder_name, r.uploaded_by)
      RETURNING id INTO target_folder_id;
    END IF;

    -- Move the file to the team-level folder
    UPDATE vault_files SET folder_id = target_folder_id WHERE id = r.file_id;
  END LOOP;
END;
$$;
