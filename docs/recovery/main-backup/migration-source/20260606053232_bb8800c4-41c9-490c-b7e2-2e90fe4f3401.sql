ALTER TABLE public.event_reminder_log ADD COLUMN IF NOT EXISTS recipient_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
CREATE INDEX IF NOT EXISTS idx_event_reminder_log_event_recipients ON public.event_reminder_log USING GIN (recipient_user_ids);
CREATE INDEX IF NOT EXISTS idx_event_reminder_log_event_sent_at ON public.event_reminder_log (event_id, sent_at DESC);