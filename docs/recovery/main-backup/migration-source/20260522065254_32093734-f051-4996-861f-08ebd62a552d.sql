-- 1) Dedupe Operations subfolders for Bridgewater Soccer Club
--    Keep the variant linked to an active chat group; soft-delete the orphans.
--    (All duplicate folders confirmed empty: 0 files, 0 subfolders.)
UPDATE public.vault_folders
SET deleted_at = now()
WHERE id IN (
  '50765ae2-9a6c-4027-8b52-6594db2c9ac8', -- Finance (orphan)
  '6fc62c26-8b8f-4d62-8185-025672aa01b4', -- Grounds (orphan)
  '4cba8893-5a28-4a99-9ce4-fa70c3734474', -- Grounds (orphan)
  'b63b5d20-d41e-4d7c-81c7-5648982b2e3f', -- Merch (orphan)
  '6451c688-db0d-45f7-8002-5f4ef1c9832c', -- Registrations (orphan)
  '41826ab2-df83-4179-9d7e-c3f62b271dd7', -- Registrations (orphan)
  '5d307714-b762-4b26-a14a-245ef6f4695d', -- Registrations (orphan)
  'd69d7a89-a25f-4c51-954a-424e22187327'  -- Sponsorship (orphan)
)
AND deleted_at IS NULL;

-- 2) When a chat group is soft-deleted, archive its linked vault folder
--    so duplicates don't accumulate when a new group of the same name is created.
CREATE OR REPLACE FUNCTION public.on_chat_group_deleted_archive_vault_folder()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.vault_folders
    SET deleted_at = now()
    WHERE chat_group_id = NEW.id
      AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_chat_group_deleted_archive_vault_folder ON public.chat_groups;
CREATE TRIGGER on_chat_group_deleted_archive_vault_folder
AFTER UPDATE OF deleted_at ON public.chat_groups
FOR EACH ROW
EXECUTE FUNCTION public.on_chat_group_deleted_archive_vault_folder();

-- Also handle hard-delete fallback.
CREATE OR REPLACE FUNCTION public.on_chat_group_hard_deleted_archive_vault_folder()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.vault_folders
  SET deleted_at = now()
  WHERE chat_group_id = OLD.id
    AND deleted_at IS NULL;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_chat_group_hard_deleted_archive_vault_folder ON public.chat_groups;
CREATE TRIGGER on_chat_group_hard_deleted_archive_vault_folder
BEFORE DELETE ON public.chat_groups
FOR EACH ROW
EXECUTE FUNCTION public.on_chat_group_hard_deleted_archive_vault_folder();