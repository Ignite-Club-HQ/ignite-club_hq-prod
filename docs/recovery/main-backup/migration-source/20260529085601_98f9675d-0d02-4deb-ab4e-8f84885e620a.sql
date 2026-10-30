-- Hard-delete Drive-sync duplicate vault_folders that were soft-deleted in the runaway recursion.
-- Indexes added in prior migration make the cascade FK checks fast.
DELETE FROM public.vault_folders
WHERE deleted_at IS NOT NULL
  AND drive_folder_id IS NOT NULL;