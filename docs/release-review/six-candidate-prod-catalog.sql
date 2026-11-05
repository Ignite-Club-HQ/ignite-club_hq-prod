-- Run only in the PROD dashboard: yabcfiuntwqjwvschnji.
-- Catalog-only; no application records, settings values, tokens or function bodies.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';
WITH relations AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE (n.nspname = 'public' AND c.relname IN (
    'profiles','direct_conversations','direct_messages','competitions','events','teams',
    'competition_roles','competition_entries','team_memberships','club_players','children',
    'child_guardians','child_team_assignments','user_roles','chat_groups','group_members',
    'app_settings','pending_invites','team_invites','club_invites'
  )) OR (n.nspname = 'auth' AND c.relname = 'users')
), evidence AS (
  SELECT 'relation' AS section, r.nspname || '.' || r.relname AS object_name,
    jsonb_build_object('kind',r.relkind,'rls',r.relrowsecurity,'forcedRls',r.relforcerowsecurity) AS details
  FROM relations r
  UNION ALL
  SELECT 'column',r.nspname || '.' || r.relname || '.' || a.attname,
    jsonb_build_object('type',pg_catalog.format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'hasDefault',a.atthasdef)
  FROM relations r JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid
  WHERE a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint',r.nspname || '.' || r.relname || '.' || c.conname,
    jsonb_build_object('type',c.contype,'validated',c.convalidated,
      'columns',c.conkey,'referencedColumns',c.confkey,
      'referencedTable',c.confrelid::regclass::text,
      'deleteAction',c.confdeltype,'definitionMd5',md5(pg_catalog.pg_get_constraintdef(c.oid)))
  FROM relations r JOIN pg_catalog.pg_constraint c ON c.conrelid = r.oid
  UNION ALL
  SELECT 'index',r.nspname || '.' || r.relname || '.' || c.relname,
    jsonb_build_object('unique',i.indisunique,'valid',i.indisvalid,'columns',i.indkey::text,
      'definitionMd5',md5(pg_catalog.pg_get_indexdef(i.indexrelid)))
  FROM relations r JOIN pg_catalog.pg_index i ON i.indrelid = r.oid
  JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  UNION ALL
  SELECT 'function',n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
    jsonb_build_object('result',pg_catalog.pg_get_function_result(p.oid),
      'securityDefiner',p.prosecdef,'owner',pg_catalog.pg_get_userbyid(p.proowner),
      'bodyMd5',md5(p.prosrc),
      'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE'))
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'send_welcome_dm','validate_event_duty_team','ensure_competition_admin_thread',
    'email_signup_invite_allowed','enforce_email_signup_invite','handle_new_user',
    'claim_pending_invites_on_profile_create','auto_claim_eois_by_email'
  )
  UNION ALL
  SELECT 'trigger',r.nspname || '.' || r.relname || '.' || t.tgname,
    jsonb_build_object('enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,
      'definitionMd5',md5(pg_catalog.pg_get_triggerdef(t.oid)))
  FROM relations r JOIN pg_catalog.pg_trigger t ON t.tgrelid = r.oid
  WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'enum',n.nspname || '.' || t.typname,
    jsonb_build_object('label',e.enumlabel,'order',e.enumsortorder)
  FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public' AND t.typname IN ('app_role','team_lifecycle_status','team_membership_status')
)
SELECT section,object_name,details FROM evidence ORDER BY section,object_name,details::text LIMIT 3001;
-- If 3001 rows are returned, treat evidence as truncated; do not approve deployment.
ROLLBACK;