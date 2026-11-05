-- Add is_external_link column to vault_files to track Google Docs/external links
ALTER TABLE public.vault_files ADD COLUMN IF NOT EXISTS is_external_link boolean DEFAULT false;

-- Add a comment explaining the column
COMMENT ON COLUMN public.vault_files.is_external_link IS 'True if file_url is an external link (e.g., Google Docs) that should open directly rather than download';