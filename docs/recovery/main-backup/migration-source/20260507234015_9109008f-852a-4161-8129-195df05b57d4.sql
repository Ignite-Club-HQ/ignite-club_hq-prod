CREATE INDEX IF NOT EXISTS idx_team_messages_team_created
  ON public.team_messages (team_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_direct_messages_conv_created
  ON public.direct_messages (conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_club_messages_club_created
  ON public.club_messages (club_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_group_messages_group_created
  ON public.group_messages (group_id, created_at DESC)
  WHERE deleted_at IS NULL;