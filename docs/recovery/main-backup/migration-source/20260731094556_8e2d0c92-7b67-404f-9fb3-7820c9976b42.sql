
CREATE OR REPLACE FUNCTION public.self_heal_dispatch_credentials()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_base text; v_needed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.notification_dispatch_log
     WHERE resolved_at > now() - interval '20 minutes'
       AND status_code IN (401, 403)
  ) INTO v_needed;

  IF NOT v_needed THEN RETURN false; END IF;

  v_base := public.internal_functions_base_url();
  IF v_base IS NULL THEN
    RAISE WARNING 'Cannot self-heal dispatch credentials: functions_base_url missing from vault';
    RETURN false;
  END IF;

  PERFORM public.bootstrap_dispatch_credentials(v_base);
  RAISE WARNING 'Refreshed internal dispatch credentials after repeated 401/403 notification failures';
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.self_heal_dispatch_credentials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.self_heal_dispatch_credentials() TO service_role;

SELECT cron.unschedule('self-heal-dispatch-credentials')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'self-heal-dispatch-credentials');

SELECT cron.schedule(
  'self-heal-dispatch-credentials',
  '*/15 * * * *',
  $cron$SELECT public.self_heal_dispatch_credentials();$cron$
);
