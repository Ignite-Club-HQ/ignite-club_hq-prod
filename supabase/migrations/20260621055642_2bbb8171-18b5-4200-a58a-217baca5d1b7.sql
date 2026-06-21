CREATE INDEX IF NOT EXISTS idx_message_reads_team_message_user ON public.message_reads (team_message_id, user_id) WHERE team_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_push_notification_logs_notification_id ON public.push_notification_logs (notification_id);