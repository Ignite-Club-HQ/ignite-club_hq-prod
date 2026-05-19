
-- Auto-create a vault folder for every club-scoped chat group, nested under a
-- category parent folder ("Club Management", "Operations", "General"...).
-- Folder is linked back to the chat group via vault_folders.chat_group_id so
-- the "View file vault" row in ChatDetailsSheet opens it directly.

CREATE OR REPLACE FUNCTION public.ensure_chat_group_vault_folder(
  _group_id uuid,
  _group_name text,
  _club_id uuid,
  _category text,
  _created_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text;
  v_parent_id uuid;
  v_child_id uuid;
BEGIN
  IF _club_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- If a folder is already linked to this group, return it (idempotent).
  SELECT id INTO v_child_id
  FROM vault_folders
  WHERE chat_group_id = _group_id
    AND deleted_at IS NULL
  LIMIT 1;
  IF v_child_id IS NOT NULL THEN
    RETURN v_child_id;
  END IF;

  v_category := NULLIF(btrim(COALESCE(_category, '')), '');
  IF v_category IS NULL THEN
    v_category := 'General';
  END IF;

  -- Find or create the category parent folder at the club root.
  SELECT id INTO v_parent_id
  FROM vault_folders
  WHERE club_id = _club_id
    AND team_id IS NULL
    AND parent_id IS NULL
    AND chat_group_id IS NULL
    AND deleted_at IS NULL
    AND lower(name) = lower(v_category)
  LIMIT 1;

  IF v_parent_id IS NULL THEN
    INSERT INTO vault_folders (club_id, team_id, parent_id, name, created_by, chat_group_id)
    VALUES (_club_id, NULL, NULL, v_category, _created_by, NULL)
    RETURNING id INTO v_parent_id;
  END IF;

  -- Create the child folder linked to this chat group.
  INSERT INTO vault_folders (club_id, team_id, parent_id, name, created_by, chat_group_id)
  VALUES (_club_id, NULL, v_parent_id, COALESCE(NULLIF(btrim(_group_name), ''), 'Group Chat'), _created_by, _group_id)
  RETURNING id INTO v_child_id;

  RETURN v_child_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_chat_group_create_vault_folder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only club-scoped groups (no team_id, no mini_league_id) auto-provision.
  IF NEW.club_id IS NOT NULL AND NEW.team_id IS NULL AND NEW.mini_league_id IS NULL THEN
    PERFORM public.ensure_chat_group_vault_folder(
      NEW.id,
      NEW.name,
      NEW.club_id,
      NEW.category,
      NEW.created_by
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_chat_group_created_make_vault_folder ON public.chat_groups;
CREATE TRIGGER on_chat_group_created_make_vault_folder
AFTER INSERT ON public.chat_groups
FOR EACH ROW
EXECUTE FUNCTION public.on_chat_group_create_vault_folder();

-- Keep the linked folder's name in sync if the group is renamed.
CREATE OR REPLACE FUNCTION public.on_chat_group_renamed_sync_vault_folder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE vault_folders
    SET name = COALESCE(NULLIF(btrim(NEW.name), ''), name),
        updated_at = now()
    WHERE chat_group_id = NEW.id
      AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_chat_group_renamed_sync_vault_folder ON public.chat_groups;
CREATE TRIGGER on_chat_group_renamed_sync_vault_folder
AFTER UPDATE OF name ON public.chat_groups
FOR EACH ROW
EXECUTE FUNCTION public.on_chat_group_renamed_sync_vault_folder();

-- One-time backfill: every existing club-scoped group gets its folder.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT g.id, g.name, g.club_id, g.category, g.created_by
    FROM chat_groups g
    WHERE g.club_id IS NOT NULL
      AND g.team_id IS NULL
      AND g.mini_league_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM vault_folders v
        WHERE v.chat_group_id = g.id
          AND v.deleted_at IS NULL
      )
  LOOP
    PERFORM public.ensure_chat_group_vault_folder(
      r.id, r.name, r.club_id, r.category, r.created_by
    );
  END LOOP;
END $$;
