-- Tune autovacuum so bloat-prone, high-churn tables get cleaned more aggressively.
-- Safe metadata-only changes (no rewrites, no locks beyond a brief ALTER).

-- vault_folders: 573 rows but 46MB due to bloat. Make autovacuum trigger far sooner.
ALTER TABLE public.vault_folders SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 50
);

-- user_activity_logs: 73k rows, lagging autovacuum.
ALTER TABLE public.user_activity_logs SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

-- push_notification_logs: high-churn audit table; keep stats fresh for the planner
-- while we wait for pg_stat_statements to identify the seq-scan source.
ALTER TABLE public.push_notification_logs SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

-- sponsor_analytics: append-heavy, benefits from frequent ANALYZE for aggregation plans.
ALTER TABLE public.sponsor_analytics SET (
  autovacuum_analyze_scale_factor = 0.05
);