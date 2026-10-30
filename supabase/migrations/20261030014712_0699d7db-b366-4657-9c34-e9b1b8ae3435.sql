DO $repair$
BEGIN
  -- Verified read-only on the connected DEV instance; stable across restarts.
  -- PROD has a different database system identifier, so promotion is a no-op.
  IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7581440907192989109' THEN
    RAISE NOTICE 'Skipping signed-out routing repair outside the verified DEV database';
    RETURN;
  END IF;
  GRANT SELECT ON public.app_settings TO anon;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_settings' AND policyname='DEV visitors can read backend routing config') THEN
    CREATE POLICY "DEV visitors can read backend routing config"
    ON public.app_settings FOR SELECT TO anon
    USING (key = 'backend_routing_config');
  END IF;
END
$repair$;
DO $verify$
DECLARE visible_count integer; unrelated_count integer;
BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7581440907192989109' THEN RETURN; END IF;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO visible_count FROM public.app_settings WHERE key='backend_routing_config';
  SELECT count(*) INTO unrelated_count FROM public.app_settings WHERE key<>'backend_routing_config';
  RESET ROLE;
  IF visible_count <> 1 THEN RAISE EXCEPTION 'Signed-out routing setting is not visible'; END IF;
  IF unrelated_count <> 0 THEN RAISE EXCEPTION 'Unrelated settings exposed to signed-out visitors'; END IF;
END
$verify$;