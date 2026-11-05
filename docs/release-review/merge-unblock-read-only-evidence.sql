-- PROD SQL Editor; bounded read-only evidence. No auth impersonation or writes.
BEGIN TRANSACTION READ ONLY;
SELECT key, value FROM public.app_settings WHERE key='backend_routing_config' LIMIT 1;
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public' AND tablename='app_settings' ORDER BY policyname;
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='app_settings' AND grantee IN ('anon','authenticated','service_role')
ORDER BY grantee, privilege_type;

SELECT p.oid::regprocedure::text AS signature, p.prosecdef AS security_definer,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
('club_news_competition_ids','validate_club_news_audience','notify_club_news',
 'is_competition_news_admin','is_competition_media_member','validate_club_news_mini_league_audience')
ORDER BY signature LIMIT 20;
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public' AND tablename='club_news' ORDER BY policyname;
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='club_news'
AND column_name IN ('target_competition_id','target_mini_league_id','target_team_ids') ORDER BY column_name;
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='club_news' AND grantee IN ('anon','authenticated','service_role')
ORDER BY grantee, privilege_type;
ROLLBACK;