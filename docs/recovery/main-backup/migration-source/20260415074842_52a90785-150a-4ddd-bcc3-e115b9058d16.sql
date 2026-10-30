
CREATE OR REPLACE FUNCTION public.backfill_chat_attachments_to_vault()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_folder_id UUID;
  v_file_name TEXT;
  v_file_type TEXT;
  v_url TEXT;
BEGIN
  -- ===== IMAGES FROM TEAM MESSAGES =====
  FOR r IN 
    SELECT tm.image_url, tm.author_id, tm.created_at, t.club_id, tm.team_id
    FROM team_messages tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.image_url IS NOT NULL AND tm.image_url != '' AND tm.deleted_at IS NULL AND t.club_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM vault_files vf WHERE vf.file_url = tm.image_url AND vf.club_id = t.club_id)
  LOOP
    SELECT id INTO v_folder_id FROM vault_folders WHERE club_id = r.club_id AND team_id IS NULL AND name = 'Chat Images' AND parent_id IS NULL;
    IF v_folder_id IS NULL THEN
      INSERT INTO vault_folders (club_id, name, created_by) VALUES (r.club_id, 'Chat Images', r.author_id) RETURNING id INTO v_folder_id;
    END IF;
    v_file_name := COALESCE(NULLIF(regexp_replace(split_part(r.image_url, '/', -1), '\?.*$', ''), ''), 'chat-image-' || extract(epoch from r.created_at)::text);
    v_file_type := CASE WHEN r.image_url ~* '\.png' THEN 'image/png' WHEN r.image_url ~* '\.gif' THEN 'image/gif' WHEN r.image_url ~* '\.webp' THEN 'image/webp' ELSE 'image/jpeg' END;
    INSERT INTO vault_files (file_url, name, file_type, club_id, team_id, uploaded_by, folder_id, is_external_link, created_at)
    VALUES (r.image_url, v_file_name, v_file_type, r.club_id, r.team_id, r.author_id, v_folder_id, false, r.created_at) ON CONFLICT DO NOTHING;
  END LOOP;

  -- ===== IMAGES FROM CLUB MESSAGES =====
  FOR r IN 
    SELECT cm.image_url, cm.author_id, cm.created_at, cm.club_id
    FROM club_messages cm
    WHERE cm.image_url IS NOT NULL AND cm.image_url != '' AND cm.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM vault_files vf WHERE vf.file_url = cm.image_url AND vf.club_id = cm.club_id)
  LOOP
    SELECT id INTO v_folder_id FROM vault_folders WHERE club_id = r.club_id AND team_id IS NULL AND name = 'Chat Images' AND parent_id IS NULL;
    IF v_folder_id IS NULL THEN
      INSERT INTO vault_folders (club_id, name, created_by) VALUES (r.club_id, 'Chat Images', r.author_id) RETURNING id INTO v_folder_id;
    END IF;
    v_file_name := COALESCE(NULLIF(regexp_replace(split_part(r.image_url, '/', -1), '\?.*$', ''), ''), 'chat-image-' || extract(epoch from r.created_at)::text);
    v_file_type := CASE WHEN r.image_url ~* '\.png' THEN 'image/png' WHEN r.image_url ~* '\.gif' THEN 'image/gif' WHEN r.image_url ~* '\.webp' THEN 'image/webp' ELSE 'image/jpeg' END;
    INSERT INTO vault_files (file_url, name, file_type, club_id, uploaded_by, folder_id, is_external_link, created_at)
    VALUES (r.image_url, v_file_name, v_file_type, r.club_id, r.author_id, v_folder_id, false, r.created_at) ON CONFLICT DO NOTHING;
  END LOOP;

  -- ===== IMAGES FROM GROUP MESSAGES =====
  FOR r IN 
    SELECT gm.image_url, gm.author_id, gm.created_at, cg.club_id AS club_id, cg.team_id AS team_id
    FROM group_messages gm
    JOIN chat_groups cg ON cg.id = gm.group_id
    WHERE gm.image_url IS NOT NULL AND gm.image_url != '' AND gm.deleted_at IS NULL AND cg.club_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM vault_files vf WHERE vf.file_url = gm.image_url AND vf.club_id = cg.club_id)
  LOOP
    SELECT id INTO v_folder_id FROM vault_folders WHERE club_id = r.club_id AND team_id IS NULL AND name = 'Chat Images' AND parent_id IS NULL;
    IF v_folder_id IS NULL THEN
      INSERT INTO vault_folders (club_id, name, created_by) VALUES (r.club_id, 'Chat Images', r.author_id) RETURNING id INTO v_folder_id;
    END IF;
    v_file_name := COALESCE(NULLIF(regexp_replace(split_part(r.image_url, '/', -1), '\?.*$', ''), ''), 'chat-image-' || extract(epoch from r.created_at)::text);
    v_file_type := CASE WHEN r.image_url ~* '\.png' THEN 'image/png' WHEN r.image_url ~* '\.gif' THEN 'image/gif' WHEN r.image_url ~* '\.webp' THEN 'image/webp' ELSE 'image/jpeg' END;
    INSERT INTO vault_files (file_url, name, file_type, club_id, team_id, uploaded_by, folder_id, is_external_link, created_at)
    VALUES (r.image_url, v_file_name, v_file_type, r.club_id, r.team_id, r.author_id, v_folder_id, false, r.created_at) ON CONFLICT DO NOTHING;
  END LOOP;

  -- ===== LINKS FROM TEAM MESSAGES =====
  FOR r IN 
    SELECT tm.text, tm.author_id, tm.created_at, t.club_id AS club_id, tm.team_id AS team_id
    FROM team_messages tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.text ~ 'https?://' AND tm.deleted_at IS NULL AND t.club_id IS NOT NULL
      AND (tm.text ~* '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|zip|png|jpg|jpeg|gif|webp|mp4|mp3)' OR tm.text ~* 'drive\.google\.com|docs\.google\.com|sheets\.google\.com|slides\.google\.com|dropbox\.com')
  LOOP
    v_url := (regexp_match(r.text, 'https?://[^\s]+'))[1];
    IF v_url IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vault_files vf WHERE vf.file_url = v_url AND vf.club_id = r.club_id) THEN
      SELECT id INTO v_folder_id FROM vault_folders WHERE club_id = r.club_id AND team_id IS NULL AND name = 'Chat Links' AND parent_id IS NULL;
      IF v_folder_id IS NULL THEN
        INSERT INTO vault_folders (club_id, name, created_by) VALUES (r.club_id, 'Chat Links', r.author_id) RETURNING id INTO v_folder_id;
      END IF;
      v_file_name := COALESCE(NULLIF(regexp_replace(split_part(v_url, '/', -1), '\?.*$', ''), ''), v_url);
      INSERT INTO vault_files (file_url, name, club_id, team_id, uploaded_by, folder_id, is_external_link, created_at)
      VALUES (v_url, v_file_name, r.club_id, r.team_id, r.author_id, v_folder_id, true, r.created_at) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- ===== LINKS FROM CLUB MESSAGES =====
  FOR r IN 
    SELECT cm.text, cm.author_id, cm.created_at, cm.club_id AS club_id
    FROM club_messages cm
    WHERE cm.text ~ 'https?://' AND cm.deleted_at IS NULL
      AND (cm.text ~* '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|zip|png|jpg|jpeg|gif|webp|mp4|mp3)' OR cm.text ~* 'drive\.google\.com|docs\.google\.com|sheets\.google\.com|slides\.google\.com|dropbox\.com')
  LOOP
    v_url := (regexp_match(r.text, 'https?://[^\s]+'))[1];
    IF v_url IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vault_files vf WHERE vf.file_url = v_url AND vf.club_id = r.club_id) THEN
      SELECT id INTO v_folder_id FROM vault_folders WHERE club_id = r.club_id AND team_id IS NULL AND name = 'Chat Links' AND parent_id IS NULL;
      IF v_folder_id IS NULL THEN
        INSERT INTO vault_folders (club_id, name, created_by) VALUES (r.club_id, 'Chat Links', r.author_id) RETURNING id INTO v_folder_id;
      END IF;
      v_file_name := COALESCE(NULLIF(regexp_replace(split_part(v_url, '/', -1), '\?.*$', ''), ''), v_url);
      INSERT INTO vault_files (file_url, name, club_id, uploaded_by, folder_id, is_external_link, created_at)
      VALUES (v_url, v_file_name, r.club_id, r.author_id, v_folder_id, true, r.created_at) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- ===== LINKS FROM GROUP MESSAGES =====
  FOR r IN 
    SELECT gm.text, gm.author_id, gm.created_at, cg.club_id AS club_id, cg.team_id AS team_id
    FROM group_messages gm
    JOIN chat_groups cg ON cg.id = gm.group_id
    WHERE gm.text ~ 'https?://' AND gm.deleted_at IS NULL AND cg.club_id IS NOT NULL
      AND (gm.text ~* '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|zip|png|jpg|jpeg|gif|webp|mp4|mp3)' OR gm.text ~* 'drive\.google\.com|docs\.google\.com|sheets\.google\.com|slides\.google\.com|dropbox\.com')
  LOOP
    v_url := (regexp_match(r.text, 'https?://[^\s]+'))[1];
    IF v_url IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vault_files vf WHERE vf.file_url = v_url AND vf.club_id = r.club_id) THEN
      SELECT id INTO v_folder_id FROM vault_folders WHERE club_id = r.club_id AND team_id IS NULL AND name = 'Chat Links' AND parent_id IS NULL;
      IF v_folder_id IS NULL THEN
        INSERT INTO vault_folders (club_id, name, created_by) VALUES (r.club_id, 'Chat Links', r.author_id) RETURNING id INTO v_folder_id;
      END IF;
      v_file_name := COALESCE(NULLIF(regexp_replace(split_part(v_url, '/', -1), '\?.*$', ''), ''), v_url);
      INSERT INTO vault_files (file_url, name, club_id, team_id, uploaded_by, folder_id, is_external_link, created_at)
      VALUES (v_url, v_file_name, r.club_id, r.team_id, r.author_id, v_folder_id, true, r.created_at) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- Run the backfill
SELECT backfill_chat_attachments_to_vault();

-- Drop after use
DROP FUNCTION IF EXISTS public.backfill_chat_attachments_to_vault();
