-- Add unique constraints for message_reads to enable upsert ON CONFLICT
-- These prevent duplicate read records and enable the upsert pattern

-- Unique constraint for team messages
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_reads_user_team_message 
ON public.message_reads (user_id, team_message_id) 
WHERE team_message_id IS NOT NULL;

-- Unique constraint for club messages
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_reads_user_club_message 
ON public.message_reads (user_id, club_message_id) 
WHERE club_message_id IS NOT NULL;

-- Unique constraint for group messages
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_reads_user_group_message 
ON public.message_reads (user_id, group_message_id) 
WHERE group_message_id IS NOT NULL;

-- Unique constraint for broadcast messages
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_reads_user_broadcast_message 
ON public.message_reads (user_id, broadcast_message_id) 
WHERE broadcast_message_id IS NOT NULL;

-- Unique constraint for direct messages
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_reads_user_direct_message 
ON public.message_reads (user_id, direct_message_id) 
WHERE direct_message_id IS NOT NULL;