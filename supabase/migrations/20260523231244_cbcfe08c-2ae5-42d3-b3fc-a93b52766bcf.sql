REVOKE EXECUTE ON FUNCTION public.join_open_chat_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_open_chat_group(uuid) TO authenticated;