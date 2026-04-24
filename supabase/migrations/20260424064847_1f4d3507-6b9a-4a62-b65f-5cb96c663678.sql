ALTER TABLE public.vault_drive_links
ADD COLUMN IF NOT EXISTS last_failed_file_ids text[] NOT NULL DEFAULT '{}';