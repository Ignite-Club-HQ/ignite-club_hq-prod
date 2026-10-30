-- Run against DEV after the signed-out routing policy repair.
-- No fixtures or persistent writes; verifies actual grants and RLS.
BEGIN;
DO $verify$
DECLARE visible_count integer; unrelated_count integer;
BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7581440907192989109' THEN
    RAISE EXCEPTION 'This regression check is for the verified DEV database only';
  END IF;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO visible_count FROM public.app_settings WHERE key='backend_routing_config';
  SELECT count(*) INTO unrelated_count FROM public.app_settings WHERE key<>'backend_routing_config';
  RESET ROLE;
  IF visible_count <> 1 THEN RAISE EXCEPTION 'Signed-out routing setting is not visible'; END IF;
  IF unrelated_count <> 0 THEN RAISE EXCEPTION 'Unrelated settings exposed to signed-out visitors'; END IF;
END
$verify$;
ROLLBACK;