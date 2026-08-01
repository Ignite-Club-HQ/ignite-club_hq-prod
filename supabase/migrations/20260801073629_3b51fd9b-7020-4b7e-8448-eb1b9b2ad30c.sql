CREATE TABLE IF NOT EXISTS public.dispatch_repair_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  checked_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  CONSTRAINT dispatch_repair_attempts_status_chk
    CHECK (status IN ('pending', 'verified', 'failed'))
);

REVOKE ALL ON TABLE public.dispatch_repair_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.dispatch_repair_attempts FROM anon;
REVOKE ALL ON TABLE public.dispatch_repair_attempts FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dispatch_repair_attempts TO service_role;

ALTER TABLE public.dispatch_repair_attempts ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_dispatch_repair_single_pending
  ON public.dispatch_repair_attempts (status)
  WHERE status = 'pending';

-- Phase 1: initiate repair. Never reports verified success.
DROP FUNCTION IF EXISTS public.self_heal_dispatch_credentials();

CREATE FUNCTION public.self_heal_dispatch_credentials()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_needed boolean;
  v_request_id bigint;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('public.self_heal_dispatch_credentials')) THEN
    RETURN 'pending';
  END IF;

  UPDATE public.dispatch_repair_attempts
     SET status = 'failed',
         failure_reason = 'timeout',
         checked_at = now(),
         completed_at = now()
   WHERE status = 'pending'
     AND deadline_at <= now();

  IF EXISTS (SELECT 1 FROM public.dispatch_repair_attempts WHERE status = 'pending') THEN
    RETURN 'pending';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.notification_dispatch_log
     WHERE resolved_at > now() - interval '20 minutes'
       AND status_code IN (401, 403)
  ) INTO v_needed;

  IF NOT v_needed THEN
    RETURN 'not_needed';
  END IF;

  v_base := public.internal_functions_base_url();
  IF v_base IS NULL THEN
    RAISE WARNING 'Cannot self-heal dispatch credentials: functions_base_url missing from vault';
    RETURN 'failed';
  END IF;

  v_request_id := public.bootstrap_dispatch_credentials(v_base);
  IF v_request_id IS NULL THEN
    RAISE WARNING 'Dispatch credential repair could not be queued';
    RETURN 'failed';
  END IF;

  INSERT INTO public.dispatch_repair_attempts (request_id, status, deadline_at)
  VALUES (v_request_id, 'pending', now() + interval '5 minutes');

  RAISE WARNING 'Queued internal dispatch credential repair after repeated 401/403 notification failures';
  RETURN 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.self_heal_dispatch_credentials() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_heal_dispatch_credentials() FROM anon;
REVOKE ALL ON FUNCTION public.self_heal_dispatch_credentials() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.self_heal_dispatch_credentials() TO service_role;

-- Phase 2: verify the exact queued request.
CREATE OR REPLACE FUNCTION public.verify_dispatch_credential_repair()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.dispatch_repair_attempts;
  v_status_code integer;
  v_content text;
  v_json jsonb;
  v_reason text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('public.verify_dispatch_credential_repair')) THEN
    RETURN 'pending';
  END IF;

  SELECT * INTO v_attempt
    FROM public.dispatch_repair_attempts
   WHERE status = 'pending'
   ORDER BY created_at ASC
   LIMIT 1
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_needed';
  END IF;

  SELECT r.status_code, r.content
    INTO v_status_code, v_content
    FROM net._http_response r
   WHERE r.id = v_attempt.request_id;

  IF NOT FOUND THEN
    IF v_attempt.deadline_at <= now() THEN
      UPDATE public.dispatch_repair_attempts
         SET status = 'failed', failure_reason = 'timeout',
             checked_at = now(), completed_at = now()
       WHERE id = v_attempt.id;
      RETURN 'failed';
    END IF;

    UPDATE public.dispatch_repair_attempts
       SET checked_at = now()
     WHERE id = v_attempt.id;
    RETURN 'pending';
  END IF;

  v_reason := NULL;

  IF v_status_code IS NULL OR v_status_code < 200 OR v_status_code > 299 THEN
    v_reason := CASE
      WHEN v_status_code IN (401, 403) THEN 'unauthorized'
      ELSE 'http_status'
    END;
  ELSE
    BEGIN
      v_json := v_content::jsonb;
    EXCEPTION WHEN others THEN
      v_json := NULL;
    END;

    IF v_json IS NULL OR jsonb_typeof(v_json) <> 'object' THEN
      v_reason := 'invalid_json';
    ELSIF coalesce(v_json->>'ok', '') <> 'true' THEN
      v_reason := 'not_ok';
    ELSIF coalesce(v_json->>'key_matches', '') <> 'true' THEN
      v_reason := 'key_mismatch';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE public.dispatch_repair_attempts
       SET status = 'failed', failure_reason = v_reason,
           checked_at = now(), completed_at = now()
     WHERE id = v_attempt.id;
    RAISE WARNING 'Dispatch credential repair failed (%)', v_reason;
    RETURN 'failed';
  END IF;

  UPDATE public.dispatch_repair_attempts
     SET status = 'verified', failure_reason = NULL,
         checked_at = now(), completed_at = now()
   WHERE id = v_attempt.id;

  RETURN 'verified';
END;
$$;

REVOKE ALL ON FUNCTION public.verify_dispatch_credential_repair() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_dispatch_credential_repair() FROM anon;
REVOKE ALL ON FUNCTION public.verify_dispatch_credential_repair() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_dispatch_credential_repair() TO service_role;

SELECT cron.unschedule('self-heal-dispatch-credentials')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'self-heal-dispatch-credentials');

SELECT cron.schedule(
  'self-heal-dispatch-credentials',
  '*/15 * * * *',
  $cron$SELECT public.self_heal_dispatch_credentials();$cron$
);

SELECT cron.unschedule('verify-dispatch-credential-repair')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'verify-dispatch-credential-repair');

SELECT cron.schedule(
  'verify-dispatch-credential-repair',
  '* * * * *',
  $cron$SELECT public.verify_dispatch_credential_repair();$cron$
);