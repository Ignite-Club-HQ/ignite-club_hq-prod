
-- 1) Enable pg_stat_statements for query observability
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 2) Drop redundant / unused indexes (CONCURRENTLY not allowed in migration tx;
--    these are small btrees, locks are momentary)

-- push_notification_logs: two redundant created_at indexes (kept idx_push_logs_created_at_status)
DROP INDEX IF EXISTS public.idx_push_notification_logs_created_at;
DROP INDEX IF EXISTS public.idx_push_logs_created_at;

-- sponsor_analytics: never-scanned indexes
DROP INDEX IF EXISTS public.idx_sponsor_analytics_sponsor_created;
DROP INDEX IF EXISTS public.idx_sponsor_analytics_sponsor_id;
DROP INDEX IF EXISTS public.idx_sponsor_analytics_created_at;

-- user_activity_logs: never-scanned indexes
DROP INDEX IF EXISTS public.idx_user_activity_started_at;
DROP INDEX IF EXISTS public.idx_user_activity_logs_created_at;

-- notifications: never-scanned dedup index
DROP INDEX IF EXISTS public.idx_notifications_rsvp_dedup_lookup;
