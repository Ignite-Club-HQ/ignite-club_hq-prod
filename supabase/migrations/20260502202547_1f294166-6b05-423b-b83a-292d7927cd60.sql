
-- One-time silent backfill: mirror existing gallery photos into vault_files
-- under a "Gallery Uploads" folder (team-scoped or club-scoped).
-- Strictly one-way; safe to re-run (deduped on club_id + file_url).

DO $$
DECLARE
  r RECORD;
  v_url TEXT;
  v_folder_id UUID;
  v_name TEXT;
BEGIN
  FOR r IN
    SELECT p.id, p.club_id, p.team_id, p.mini_league_id, p.uploader_id,
           COALESCE(p.file_url, p.image_url) AS url,
           p.file_size, p.title, p.created_at
    FROM public.photos p
    WHERE p.deleted_at IS NULL
      AND p.club_id IS NOT NULL
      AND COALESCE(p.file_url, p.image_url) IS NOT NULL
  LOOP
    v_url := r.url;

    -- Skip if already mirrored
    IF EXISTS (
      SELECT 1 FROM public.vault_files
      WHERE club_id = r.club_id AND file_url = v_url
    ) THEN
      CONTINUE;
    END IF;

    -- Find or create the "Gallery Uploads" folder for this scope
    SELECT id INTO v_folder_id
    FROM public.vault_folders
    WHERE club_id = r.club_id
      AND name = 'Gallery Uploads'
      AND parent_id IS NULL
      AND chat_group_id IS NULL
      AND restricted_roles IS NULL
      AND ((r.team_id IS NULL AND team_id IS NULL)
           OR (r.team_id IS NOT NULL AND team_id = r.team_id))
    LIMIT 1;

    IF v_folder_id IS NULL THEN
      INSERT INTO public.vault_folders (club_id, name, created_by, team_id)
      VALUES (r.club_id, 'Gallery Uploads',
              COALESCE(r.uploader_id, '00000000-0000-0000-0000-000000000000'::uuid),
              r.team_id)
      RETURNING id INTO v_folder_id;
    END IF;

    v_name := COALESCE(NULLIF(r.title, ''), regexp_replace(v_url, '^.*/', ''), 'photo');

    INSERT INTO public.vault_files
      (file_url, name, file_type, file_size, is_external_link,
       club_id, team_id, mini_league_id, uploaded_by, folder_id, created_at)
    VALUES
      (v_url, v_name, 'image/jpeg', r.file_size, false,
       r.club_id, r.team_id, r.mini_league_id,
       COALESCE(r.uploader_id, '00000000-0000-0000-0000-000000000000'::uuid),
       v_folder_id, COALESCE(r.created_at, now()));
  END LOOP;
END $$;
