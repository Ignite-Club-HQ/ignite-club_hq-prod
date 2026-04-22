-- Backfill: move existing chat-attachment vault files that originated in
-- role-restricted chat groups out of the generic "Chat Images"/"Chat Links"
-- club folders and into a dedicated folder per chat group, matching the
-- new behavior in chatVaultSync.ts.
--
-- Strategy:
--   1. For every (chat_group, club) where the group is role-restricted AND
--      a vault file's URL appears either as a message image_url or inside
--      a message text URL, ensure a vault folder exists for that group
--      (linked via chat_group_id, with restricted_roles = allowed_roles).
--   2. Repoint the matching vault_files.folder_id to that folder.
--
-- Idempotent: re-running is a no-op once files have been moved.

DO $$
DECLARE
  rec record;
  target_folder_id uuid;
  creator_id uuid;
BEGIN
  -- Build the set of (file_id -> chat_group) matches in a CTE, then act on each.
  FOR rec IN
    WITH restricted_groups AS (
      SELECT id, club_id, name, allowed_roles, created_by
      FROM public.chat_groups
      WHERE allowed_roles && ARRAY['club_admin','committee_member','coach','team_admin','league_admin']::public.app_role[]
    ),
    club_chat_files AS (
      SELECT vf.id AS file_id, vf.file_url, vf.club_id, vf.is_external_link
      FROM public.vault_files vf
      JOIN public.vault_folders fld ON fld.id = vf.folder_id
      WHERE fld.name IN ('Chat Images','Chat Links')
        AND fld.team_id IS NULL
        AND fld.chat_group_id IS NULL
        AND fld.restricted_roles IS NULL
    ),
    image_matches AS (
      SELECT ccf.file_id, rg.id AS chat_group_id, rg.club_id, rg.name AS group_name,
             rg.allowed_roles, rg.created_by
      FROM club_chat_files ccf
      JOIN public.group_messages gm ON gm.image_url = ccf.file_url
      JOIN restricted_groups rg ON rg.id = gm.group_id AND rg.club_id = ccf.club_id
      WHERE ccf.is_external_link = false
    ),
    link_matches AS (
      SELECT DISTINCT ON (ccf.file_id)
             ccf.file_id, rg.id AS chat_group_id, rg.club_id, rg.name AS group_name,
             rg.allowed_roles, rg.created_by
      FROM club_chat_files ccf
      JOIN public.group_messages gm ON gm.text ~ 'https?://' AND position(ccf.file_url IN gm.text) > 0
      JOIN restricted_groups rg ON rg.id = gm.group_id AND rg.club_id = ccf.club_id
      WHERE ccf.is_external_link = true
    )
    SELECT * FROM image_matches
    UNION ALL
    SELECT * FROM link_matches
  LOOP
    -- Look up an existing chat-group folder, or create one.
    SELECT id INTO target_folder_id
    FROM public.vault_folders
    WHERE club_id = rec.club_id
      AND chat_group_id = rec.chat_group_id
      AND parent_id IS NULL
    LIMIT 1;

    IF target_folder_id IS NULL THEN
      -- created_by must be a real user; fall back to the chat group's creator,
      -- or any club admin if creator isn't available.
      creator_id := rec.created_by;
      IF creator_id IS NULL THEN
        SELECT user_id INTO creator_id
        FROM public.user_roles
        WHERE club_id = rec.club_id AND role = 'club_admin'
        LIMIT 1;
      END IF;

      INSERT INTO public.vault_folders
        (club_id, name, created_by, team_id, chat_group_id, restricted_roles)
      VALUES
        (rec.club_id, rec.group_name, creator_id, NULL, rec.chat_group_id, rec.allowed_roles)
      RETURNING id INTO target_folder_id;
    END IF;

    -- Move the file into the new folder.
    UPDATE public.vault_files
    SET folder_id = target_folder_id
    WHERE id = rec.file_id;
  END LOOP;
END $$;