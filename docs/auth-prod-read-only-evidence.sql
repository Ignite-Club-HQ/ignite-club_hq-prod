-- REVIEW ONLY. Do not run until Paul explicitly approves read-only PROD inspection.
-- No credentials, user exports, writes, grants, migrations or worker operations.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

-- Independently bind the report to the approved connection before trusting it.
SELECT current_database() AS database_name, current_user AS inspection_role,
       current_setting('app.settings.project_ref', true) AS configured_project_ref,
       current_setting('app.settings.supabase_url', true) AS configured_project_url;
-- Hosted settings may be null: they do not prove which project was inspected.

SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;

SELECT p.oid::regprocedure::text AS function_signature,
       pg_get_functiondef(p.oid) AS definition, p.prosecdef AS security_definer,
       p.proconfig AS function_settings, p.proacl AS privileges
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('handle_new_user', 'email_signup_invite_allowed',
                   'enforce_email_signup_invitation')
ORDER BY p.oid::regprocedure::text;

SELECT t.tgname AS trigger_name, t.tgenabled AS enabled,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal
ORDER BY t.tgname;

SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings'
ORDER BY policyname;
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'app_settings'
  AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
ORDER BY grantee, privilege_type;

-- Restrict content to the public sign-in setting, not the other settings rows.
SELECT key, value->'emailAuthClubs' AS email_auth_clubs,
       jsonb_typeof(value->'emailAuthClubs') AS email_auth_clubs_type
FROM public.app_settings WHERE key = 'backend_routing_config';
SELECT id, name FROM public.clubs
WHERE lower(trim(name)) IN ('bridgewater soccer club', 'basket range cricket club')
ORDER BY name, id;

-- Schema only: no invitation tokens, emails, accounts or private row contents.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profiles', 'pending_invites', 'team_invites', 'club_invites', 'teams')
ORDER BY table_name, ordinal_position;
ROLLBACK;