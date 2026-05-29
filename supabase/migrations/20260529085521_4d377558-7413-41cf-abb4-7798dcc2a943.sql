-- Required to make cascading deletes on vault_folders not seq-scan child tables.
CREATE INDEX IF NOT EXISTS idx_photos_folder_id ON public.photos(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vault_folders_parent_id_all ON public.vault_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_chat_pinned_vault_folder_id ON public.chat_pinned_vault(vault_folder_id);