DO $repair$
DECLARE
  project_ref text := current_setting('app.settings.project_ref', true);
  api_url text := current_setting('app.settings.api_external_url', true);
BEGIN
  -- This repair is deliberately inactive on PROD and unknown environments.
  IF project_ref IS DISTINCT FROM 'ecsdwrarzfexssxtrymj'
     AND coalesce(api_url, '') !~ '^https://ecsdwrarzfexssxtrymj[.]supabase[.]co/?$' THEN
    RAISE NOTICE 'Skipping DEV-only signed-out routing policy repair on this environment';
    RETURN;
  END IF;
  GRANT SELECT ON public.app_settings TO anon;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'app_settings' AND policyname = 'DEV visitors can read backend routing config'
  ) THEN
    CREATE POLICY "DEV visitors can read backend routing config"
    ON public.app_settings FOR SELECT TO anon
    USING (key = 'backend_routing_config');
  END IF;
END
$repair$;