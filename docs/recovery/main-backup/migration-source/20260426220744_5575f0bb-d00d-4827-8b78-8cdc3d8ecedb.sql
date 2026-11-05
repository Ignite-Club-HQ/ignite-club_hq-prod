DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'photo_comments') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.photo_comments';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'photo_reactions') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.photo_reactions';
  END IF;
END$$;

ALTER TABLE public.photo_comments REPLICA IDENTITY FULL;
ALTER TABLE public.photo_reactions REPLICA IDENTITY FULL;