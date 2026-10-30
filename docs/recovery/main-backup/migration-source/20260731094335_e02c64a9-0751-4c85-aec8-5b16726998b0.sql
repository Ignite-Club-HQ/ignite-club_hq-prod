
CREATE TABLE IF NOT EXISTS public.dispatch_bootstrap_tokens (
  token text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.dispatch_bootstrap_tokens TO service_role;
ALTER TABLE public.dispatch_bootstrap_tokens ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: backend-only table.

CREATE OR REPLACE FUNCTION public.consume_dispatch_bootstrap_token(_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ok boolean := false;
BEGIN
  UPDATE public.dispatch_bootstrap_tokens
     SET used_at = now()
   WHERE token = _token
     AND used_at IS NULL
     AND expires_at > now();
  GET DIAGNOSTICS v_ok = ROW_COUNT;
  DELETE FROM public.dispatch_bootstrap_tokens WHERE expires_at < now() - interval '1 hour';
  RETURN v_ok;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_dispatch_bootstrap_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_dispatch_bootstrap_token(text) TO service_role;

CREATE OR REPLACE FUNCTION public.bootstrap_dispatch_credentials(_base_url text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_token text; v_request_id bigint;
BEGIN
  IF _base_url IS NULL OR _base_url !~ '^https://' THEN
    RAISE EXCEPTION 'invalid base url';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.dispatch_bootstrap_tokens (token, expires_at)
  VALUES (v_token, now() + interval '2 minutes');

  SELECT net.http_post(
    url := _base_url || '/functions/v1/sync-dispatch-credentials',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bootstrap-token', v_token),
    body := '{}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_dispatch_credentials(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_dispatch_credentials(text) TO service_role;
