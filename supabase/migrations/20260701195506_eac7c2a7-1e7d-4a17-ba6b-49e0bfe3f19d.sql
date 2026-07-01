ALTER TABLE public.chat_group_unread REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_group_unread;