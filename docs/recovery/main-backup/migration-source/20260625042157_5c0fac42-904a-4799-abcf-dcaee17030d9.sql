CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Unschedule any prior job with the same name to keep this idempotent
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-expired-chat-summaries');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cleanup-expired-chat-summaries',
  '15 3 * * *',
  $$ SELECT public.cleanup_expired_chat_summaries(); $$
);