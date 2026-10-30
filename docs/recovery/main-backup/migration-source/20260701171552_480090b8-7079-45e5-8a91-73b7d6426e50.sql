-- Notifications: hot queries filter by user_id + is_read, and user_id + club_id
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, created_at DESC)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_user_club_created
  ON public.notifications (user_id, club_id, created_at DESC);

-- message_reads: three hot ANY() lookups per chat surface
CREATE INDEX IF NOT EXISTS idx_message_reads_team_user
  ON public.message_reads (team_message_id, user_id)
  WHERE team_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_reads_group_user
  ON public.message_reads (group_message_id, user_id)
  WHERE group_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_reads_club_user
  ON public.message_reads (club_message_id, user_id)
  WHERE club_message_id IS NOT NULL;

-- push_notification_logs: 60k+ existence checks by notification_id
CREATE INDEX IF NOT EXISTS idx_push_notification_logs_notification_id
  ON public.push_notification_logs (notification_id);

-- children by parent_id: 112k calls
CREATE INDEX IF NOT EXISTS idx_children_parent_id
  ON public.children (parent_id);

-- child_team_assignments: nested lateral joins filter by both
CREATE INDEX IF NOT EXISTS idx_child_team_assignments_team_child
  ON public.child_team_assignments (team_id, child_id);
