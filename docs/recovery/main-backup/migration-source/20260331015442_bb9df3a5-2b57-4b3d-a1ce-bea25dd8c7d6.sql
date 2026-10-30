-- =============================================
-- Performance: Add missing indexes for slow queries
-- =============================================

-- 1. mini_league_players.parent_user_id - used heavily in RLS functions
-- (is_league_parent, can_access_mini_league_chat, can_view_mini_league)
-- Currently causing 464K seq scans
CREATE INDEX IF NOT EXISTS idx_mini_league_players_parent_user_id 
ON public.mini_league_players (parent_user_id);

-- 2. children.parent_id - used in RLS and child lookup queries
-- Currently causing 35.8K seq scans
CREATE INDEX IF NOT EXISTS idx_children_parent_id 
ON public.children (parent_id);

-- 3. chat_groups.club_id - used in RLS policy can_access_chat_group
-- Currently causing 50.9K seq scans
CREATE INDEX IF NOT EXISTS idx_chat_groups_club_id 
ON public.chat_groups (club_id);

-- 4. chat_groups.team_id - used in RLS policy can_access_chat_group
CREATE INDEX IF NOT EXISTS idx_chat_groups_team_id 
ON public.chat_groups (team_id);

-- 5. photo_comments.photo_id - used for fetching comments per photo
-- Currently causing 6.9K seq scans
CREATE INDEX IF NOT EXISTS idx_photo_comments_photo_id 
ON public.photo_comments (photo_id);

-- 6. user_passkeys.user_id - causing 46.9K seq scans
CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id 
ON public.user_passkeys (user_id);

-- 7. sponsor_analytics - composite index for common query patterns
-- Currently causing 33.4M row reads with 24.6K rows
CREATE INDEX IF NOT EXISTS idx_sponsor_analytics_sponsor_created 
ON public.sponsor_analytics (sponsor_id, created_at DESC);

-- 8. push_notification_logs - optimize cleanup queries
-- 3K seq scans reading 6M rows
CREATE INDEX IF NOT EXISTS idx_push_logs_created_at_status 
ON public.push_notification_logs (created_at, status);

-- 9. rsvps composite index for event+user lookups (very common pattern)
CREATE INDEX IF NOT EXISTS idx_rsvps_event_user 
ON public.rsvps (event_id, user_id);

-- 10. photo_reactions.photo_id - for fetching reactions per photo
CREATE INDEX IF NOT EXISTS idx_photo_reactions_photo_id 
ON public.photo_reactions (photo_id);