ALTER TABLE public.club_news
  ADD COLUMN IF NOT EXISTS chat_posted_at timestamptz;