-- Run the prune every 15 minutes. Since the function only DELETEs from one
-- table within the same DB it doesn't need pg_net or any secrets — pg_cron
-- can call the SQL function directly.
SELECT cron.schedule(
  'prune-active-games-write-log',
  '*/15 * * * *',
  $$ SELECT public.prune_active_games_write_log(); $$
);