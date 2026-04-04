
CREATE TABLE public.engagement_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  unread_messages_count int NOT NULL DEFAULT 0,
  unread_photos_count int NOT NULL DEFAULT 0
);

CREATE INDEX idx_engagement_reminder_log_user_sent ON public.engagement_reminder_log (user_id, sent_at DESC);

ALTER TABLE public.engagement_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON public.engagement_reminder_log
  FOR ALL USING (false);
