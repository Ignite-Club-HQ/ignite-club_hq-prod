
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created
  ON public.notifications (user_id, created_at DESC)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_user_club_created
  ON public.notifications (user_id, club_id, created_at DESC);

ANALYZE public.notifications;
