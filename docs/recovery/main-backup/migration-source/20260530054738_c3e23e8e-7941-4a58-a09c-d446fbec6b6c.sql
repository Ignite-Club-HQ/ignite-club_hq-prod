-- Phase 1: Drop 5 unsubscribed tables from the supabase_realtime publication
-- These tables have zero postgres_changes subscriptions in the codebase.

ALTER PUBLICATION supabase_realtime DROP TABLE public.poll_options;
ALTER PUBLICATION supabase_realtime DROP TABLE public.match_messages;
ALTER PUBLICATION supabase_realtime DROP TABLE public.club_rewards;
ALTER PUBLICATION supabase_realtime DROP TABLE public.reward_redemptions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.photo_comment_reactions;
