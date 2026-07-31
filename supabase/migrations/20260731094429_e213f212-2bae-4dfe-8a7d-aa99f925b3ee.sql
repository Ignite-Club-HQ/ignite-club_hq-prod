
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

  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

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

SELECT public.bootstrap_dispatch_credentials('https://ecsdwrarzfexssxtrymj.supabase.co');
