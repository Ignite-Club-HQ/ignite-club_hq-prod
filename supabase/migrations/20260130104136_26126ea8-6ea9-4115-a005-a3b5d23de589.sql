-- Add deleted_by column to vault_files if it doesn't exist
ALTER TABLE public.vault_files
ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);