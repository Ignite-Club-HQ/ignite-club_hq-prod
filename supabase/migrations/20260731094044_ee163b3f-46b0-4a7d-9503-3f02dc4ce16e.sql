
-- 1. Dispatch log ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id bigint,
  message_type text NOT NULL,
  message_id uuid,
  target_function text NOT NULL DEFAULT 'process-message-notifications',
  status_code int,
  error_detail text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notification_dispatch_log TO authenticated;
GRANT ALL ON public.notification_dispatch_log TO service_role;

ALTER TABLE public.notification_dispatch_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "App admins can read dispatch log" ON public.notification_dispatch_log;
CREATE POLICY "App admins can read dispatch log"
  ON public.notification_dispatch_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'app_admin'));

CREATE INDEX IF NOT EXISTS idx_ndl_unresolved
  ON public.notification_dispatch_log (created_at)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ndl_status
  ON public.notification_dispatch_log (status_code, created_at DESC);

DROP TRIGGER IF EXISTS trg_ndl_updated_at ON public.notification_dispatch_log;
CREATE TRIGGER trg_ndl_updated_at
  BEFORE UPDATE ON public.notification_dispatch_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Recording helper --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_notification_dispatch(
  _request_id bigint,
  _message_type text,
  _message_id uuid,
  _error_detail text DEFAULT NULL,
  _target_function text DEFAULT 'process-message-notifications'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_dispatch_log
    (request_id, message_type, message_id, target_function, error_detail,
     status_code, resolved_at)
  VALUES
    (_request_id, _message_type, _message_id, _target_function, _error_detail,
     CASE WHEN _error_detail IS NOT NULL THEN -1 ELSE NULL END,
     CASE WHEN _error_detail IS NOT NULL THEN now() ELSE NULL END);
EXCEPTION WHEN OTHERS THEN
  -- Logging must never break the originating message insert.
  NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_notification_dispatch(bigint, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_notification_dispatch(bigint, text, uuid, text, text) TO service_role;

-- 3. Reconciler: join pending attempts to net._http_response -----------------
CREATE OR REPLACE FUNCTION public.reconcile_notification_dispatch_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.notification_dispatch_log l
     SET status_code = r.status_code,
         error_detail = CASE WHEN r.status_code BETWEEN 200 AND 299
                             THEN NULL ELSE left(coalesce(r.content, ''), 500) END,
         resolved_at = now()
    FROM net._http_response r
   WHERE l.resolved_at IS NULL
     AND l.request_id IS NOT NULL
     AND r.id = l.request_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Attempts with no response row after 10 minutes are treated as lost.
  UPDATE public.notification_dispatch_log
     SET status_code = -2,
         error_detail = 'No HTTP response recorded (request lost or expired)',
         resolved_at = now()
   WHERE resolved_at IS NULL
     AND created_at < now() - interval '10 minutes';

  -- Raise a monitored warning for recent failures.
  IF EXISTS (
    SELECT 1 FROM public.notification_dispatch_log
     WHERE resolved_at > now() - interval '5 minutes'
       AND (status_code IS NULL OR status_code < 200 OR status_code > 299)
  ) THEN
    RAISE WARNING 'notification dispatch failures detected in the last 5 minutes; see public.notification_dispatch_log';
  END IF;

  -- Retention: keep 14 days.
  DELETE FROM public.notification_dispatch_log WHERE created_at < now() - interval '14 days';

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_notification_dispatch_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_notification_dispatch_log() TO service_role;

SELECT cron.unschedule('reconcile-notification-dispatch-log')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-notification-dispatch-log');

SELECT cron.schedule(
  'reconcile-notification-dispatch-log',
  '* * * * *',
  $cron$SELECT public.reconcile_notification_dispatch_log();$cron$
);

-- 4. Service-only vault refresh ----------------------------------------------
CREATE OR REPLACE FUNCTION public.set_internal_dispatch_credentials(
  _service_role_key text,
  _functions_base_url text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key_id uuid;
  v_url_id uuid;
BEGIN
  IF _service_role_key IS NULL OR length(_service_role_key) < 40 THEN
    RAISE EXCEPTION 'invalid service role key';
  END IF;
  IF _functions_base_url IS NULL OR _functions_base_url !~ '^https://' THEN
    RAISE EXCEPTION 'invalid functions base url';
  END IF;

  SELECT id INTO v_key_id FROM vault.secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_key_id IS NULL THEN
    PERFORM vault.create_secret(_service_role_key, 'service_role_key', 'Service role key for internal edge function dispatch');
  ELSE
    PERFORM vault.update_secret(v_key_id, _service_role_key, 'service_role_key', 'Service role key for internal edge function dispatch');
  END IF;

  SELECT id INTO v_url_id FROM vault.secrets WHERE name = 'functions_base_url' LIMIT 1;
  IF v_url_id IS NULL THEN
    PERFORM vault.create_secret(_functions_base_url, 'functions_base_url', 'Base URL for edge function dispatch');
  ELSE
    PERFORM vault.update_secret(v_url_id, _functions_base_url, 'functions_base_url', 'Base URL for edge function dispatch');
  END IF;

  RETURN jsonb_build_object(
    'key_updated', true,
    'url_updated', true,
    'key_matches', public.internal_service_role_key() = _service_role_key,
    'base_url', public.internal_functions_base_url()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_internal_dispatch_credentials(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_internal_dispatch_credentials(text, text) TO service_role;
