-- =============================================
-- DB Tuning: Drop unused indexes, add missing, tune autovacuum
-- =============================================

-- #2: DROP UNUSED INDEXES (all have 0 scans)
DROP INDEX IF EXISTS public.idx_teams_is_archived;
DROP INDEX IF EXISTS public.idx_events_reminder_pending;
DROP INDEX IF EXISTS public.idx_push_subscriptions_last_success;
DROP INDEX IF EXISTS public.idx_event_guests_added_by;
DROP INDEX IF EXISTS public.idx_user_activity_session;
DROP INDEX IF EXISTS public.idx_user_activity_user_id;
DROP INDEX IF EXISTS public.idx_points_cooldowns_daily_cap;
DROP INDEX IF EXISTS public.idx_points_cooldowns_lookup;

-- #3: AUTOVACUUM TUNING on high-churn tables
ALTER TABLE public.active_games SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.notifications SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.push_notification_logs SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.rsvps SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.sponsor_analytics SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

-- #4: ADD MISSING INDEX
CREATE INDEX IF NOT EXISTS idx_club_rewards_club_id 
ON public.club_rewards (club_id);