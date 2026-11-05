-- Owner-run PROD evidence: yabcfiuntwqjwvschnji. Read only, no deployment.
-- No business rows, settings values, tokens, bodies, scheduler commands or credentials.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';
WITH requested_tables(name) AS (
 SELECT unnest(ARRAY[
  'profiles','clubs','teams','events','photos','photo_views','club_dm_settings',
  'competitions','competition_entries','competition_roles','competition_matches',
  'competition_event_operations','competition_event_audience','club_news',
  'club_invite_message_defaults','competition_role_links','competition_role_invites',
  'competition_role_email_invites','team_invites','pending_invites','club_invites',
  'team_memberships','user_roles','chat_groups','group_members','direct_conversations',
  'direct_messages','vault_folders','vault_files','canister_memory_reports',
  'welcome_email_settings','welcome_email_deliveries','icp_welcome_email_deliveries',
  'app_settings','club_players','children','child_guardians','child_team_assignments'
 ]::text[])
), requested_functions(name) AS (
 SELECT unnest(ARRAY[
  'send_welcome_dm','email_signup_invite_allowed','enforce_email_signup_invite',
  'handle_new_user','is_competition_media_member','can_manage_competition_media',
  'create_competition_event','can_create_competition_event','is_competition_news_admin',
  'is_competition_audience','validate_club_news_mini_league_audience',
  'validate_club_news_audience','club_news_competition_ids','notify_club_news',
  'can_invite_players_to_team','can_view_competition_fixture_event',
  'get_my_viewable_competition_match_ids','can_view_pending_role_request_profile',
  'get_competition_role_link_status','accept_competition_role_link',
  'create_competition_role_email_invite','get_competition_role_email_invite_status',
  'accept_competition_role_email_invite','revoke_competition_role_email_invite',
  'invite_competition_official','claim_competition_role_invites_on_profile_create',
  'can_access_competition_vault','can_manage_competition_vault',
  'can_access_vault_folder','can_access_vault_file','tg_competition_roles_enforce_owner',
  'tg_competition_role_sync_chat','tg_competition_role_sync_contact_chats',
  'club_is_paid','list_expired_free_media','purge_expired_free_media_rows'
 ]::text[])
), relations AS (
 SELECT c.oid,n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE (n.nspname='public' AND c.relname IN (SELECT name FROM requested_tables))
    OR (n.nspname='auth' AND c.relname='users')
), functions AS (
 SELECT p.*,n.nspname FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind='f'
 AND (p.proname IN (SELECT name FROM requested_functions)
   OR p.oid IN (SELECT t.tgfoid FROM pg_catalog.pg_trigger t
               WHERE NOT t.tgisinternal AND t.tgrelid IN (SELECT oid FROM relations)))
), evidence(section,object_name,details) AS (
 SELECT 'requested_table','public.' || q.name,
   jsonb_build_object('present',EXISTS(SELECT 1 FROM relations r WHERE r.nspname='public' AND r.relname=q.name))
 FROM requested_tables q
 UNION ALL
 SELECT 'requested_function','public.' || q.name,
   jsonb_build_object('present',EXISTS(SELECT 1 FROM functions f WHERE f.proname=q.name))
 FROM requested_functions q
 UNION ALL
 SELECT 'relation',r.nspname || '.' || r.relname,
   jsonb_build_object('kind',r.relkind,'rls',r.relrowsecurity,'forcedRls',r.relforcerowsecurity)
 FROM relations r
 UNION ALL
 SELECT 'column',r.nspname || '.' || r.relname || '.' || a.attname,
   jsonb_build_object('type',pg_catalog.format_type(a.atttypid,a.atttypmod),
     'notNull',a.attnotnull,'hasDefault',a.atthasdef,
     'defaultMd5',md5(pg_catalog.pg_get_expr(d.adbin,d.adrelid)))
 FROM relations r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'constraint',r.nspname || '.' || r.relname || '.' || c.conname,
   jsonb_build_object('type',c.contype,'validated',c.convalidated,
     'columns',c.conkey,'referencedColumns',c.confkey,
     'referencedTable',c.confrelid::regclass::text,'deleteAction',c.confdeltype,
     'definitionMd5',md5(pg_catalog.pg_get_constraintdef(c.oid)))
 FROM relations r JOIN pg_catalog.pg_constraint c ON c.conrelid=r.oid
 UNION ALL
 SELECT 'index',r.nspname || '.' || r.relname || '.' || c.relname,
   jsonb_build_object('unique',i.indisunique,'valid',i.indisvalid,
     'definitionMd5',md5(pg_catalog.pg_get_indexdef(i.indexrelid)))
 FROM relations r JOIN pg_catalog.pg_index i ON i.indrelid=r.oid
 JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
 UNION ALL
 SELECT 'policy',r.nspname || '.' || r.relname || '.' || p.polname,
   jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,
     'roles',(SELECT jsonb_agg(CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x)::text END ORDER BY x)
              FROM unnest(p.polroles) x),
     'usingMd5',md5(pg_catalog.pg_get_expr(p.polqual,p.polrelid)),
     'checkMd5',md5(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)))
 FROM relations r JOIN pg_catalog.pg_policy p ON p.polrelid=r.oid
 UNION ALL
 SELECT 'table_privilege',r.nspname || '.' || r.relname || ':' || roles.name,
   jsonb_build_object('select',has_table_privilege(roles.name,r.oid,'SELECT'),
     'insert',has_table_privilege(roles.name,r.oid,'INSERT'),
     'update',has_table_privilege(roles.name,r.oid,'UPDATE'),
     'delete',has_table_privilege(roles.name,r.oid,'DELETE'))
 FROM relations r CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) roles(name)
 UNION ALL
 SELECT 'function',f.nspname || '.' || f.proname || '(' || pg_catalog.pg_get_function_identity_arguments(f.oid) || ')',
   jsonb_build_object('result',pg_catalog.pg_get_function_result(f.oid),
     'bodyMd5',md5(f.prosrc),'definitionMd5',md5(pg_catalog.pg_get_functiondef(f.oid)),
     'securityDefiner',f.prosecdef,'owner',pg_catalog.pg_get_userbyid(f.proowner),
     'anonExecute',has_function_privilege('anon',f.oid,'EXECUTE'),
     'authenticatedExecute',has_function_privilege('authenticated',f.oid,'EXECUTE'),
     'serviceExecute',has_function_privilege('service_role',f.oid,'EXECUTE'))
 FROM functions f
 UNION ALL
 SELECT 'trigger',r.nspname || '.' || r.relname || '.' || t.tgname,
   jsonb_build_object('enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,
     'definitionMd5',md5(pg_catalog.pg_get_triggerdef(t.oid)))
 FROM relations r JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.oid
 WHERE NOT t.tgisinternal
), numbered AS (
 SELECT *,count(*) OVER () AS total_rows FROM evidence
)
SELECT section,object_name,details,total_rows FROM numbered
ORDER BY section,object_name,details::text LIMIT 5001;
-- If total_rows exceeds the returned row count, evidence is truncated. Do not approve release.
ROLLBACK;