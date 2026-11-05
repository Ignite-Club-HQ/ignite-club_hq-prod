-- Single-result version of competition-functions-target-check.sql (the SQL Editor only shows the last result).
-- Read-only, catalog only.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT * FROM (
  SELECT 'function' AS section, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name,
         md5(pg_get_functiondef(p.oid)) || ' | ' || coalesce(p.proacl::text,'') AS detail
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (
   'is_competition_admin','can_organise_competition','is_association_admin',
   'can_view_competition_fixture_event','get_my_viewable_competition_match_ids',
   'can_access_competition_vault','can_manage_competition_vault',
   'create_competition_role_email_invite','accept_competition_role_email_invite',
   'get_competition_role_email_invite_status','revoke_competition_role_email_invite')
  UNION ALL
  SELECT 'constraint', c.relname || '.' || x.conname, pg_get_constraintdef(x.oid)
  FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('competition_roles','competition_role_email_invites')
  UNION ALL
  SELECT 'policy', tablename || '.' || policyname, cmd || ' ' || roles::text || ' | ' || md5(coalesce(qual,'') || '|' || coalesce(with_check,''))
  FROM pg_policies WHERE schemaname='public' AND tablename IN ('events','vault_folders','vault_files','competition_role_email_invites')
  UNION ALL
  SELECT 'table', t.table_name, 'present'
  FROM information_schema.tables t
  WHERE t.table_schema='public' AND t.table_name IN ('competition_role_email_invites','vault_folders','vault_files')
) r ORDER BY 1,2;
ROLLBACK;
