ALTER TABLE public.vault_drive_links DROP COLUMN IF EXISTS last_failed_file_ids;
ALTER TABLE public.vault_drive_links
ADD COLUMN IF NOT EXISTS last_failed_files jsonb NOT NULL DEFAULT '[]'::jsonb;