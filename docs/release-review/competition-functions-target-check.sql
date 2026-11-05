-- Run read-only against PROD before selecting the candidate for deployment.
-- Catalog only: no member data, invite email/token/code or stored business values.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_functiondef(p.oid) AS definition, p.proacl::text AS grants
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
 'is_competition_admin','can_organise_competition','is_association_admin',
 'can_view_competition_fixture_event','get_my_viewable_competition_match_ids',
 'can_access_competition_vault','can_manage_competition_vault',
 'create_competition_role_email_invite','accept_competition_role_email_invite',
 'get_competition_role_email_invite_status','revoke_competition_role_email_invite')
ORDER BY 1,2 LIMIT 30;
SELECT c.relname,x.conname,pg_get_constraintdef(x.oid) AS definition
FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('competition_roles','competition_role_email_invites')
ORDER BY 1,2 LIMIT 40;
SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' AND tablename IN ('events','vault_folders','vault_files','competition_role_email_invites')
ORDER BY 1,2 LIMIT 100;
SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('competition_roles','profiles') AND NOT t.tgisinternal
ORDER BY 1,2 LIMIT 40;
ROLLBACK;