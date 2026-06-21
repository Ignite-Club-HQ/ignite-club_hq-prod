
REVOKE EXECUTE ON FUNCTION public.try_cron_lock(text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_cron_lock(text) FROM PUBLIC, anon, authenticated;
