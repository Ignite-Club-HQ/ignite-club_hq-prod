
REVOKE EXECUTE ON FUNCTION public.ensure_chat_group_vault_folder(uuid, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_chat_group_create_vault_folder() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_chat_group_renamed_sync_vault_folder() FROM PUBLIC, anon, authenticated;
