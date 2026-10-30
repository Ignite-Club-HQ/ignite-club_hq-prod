-- READ ONLY: run in the approved PROD SQL Editor, export the single result.
-- No application records, routing values, auth accounts or scheduler commands.
-- Function definitions/default expressions can contain embedded secrets: review before sharing.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
WITH requested(name) AS (SELECT unnest(ARRAY[
    'accept_competition_role_link',
    'apply_training_defaults_on_event',
    'can_access_chat_group',
    'can_access_competition_vault',
    'can_access_vault_file',
    'can_access_vault_folder',
    'can_create_competition_event',
    'can_invite_players_to_team',
    'can_manage_competition_media',
    'can_manage_competition_vault',
    'cleanup_notifications_for_deleted_photo',
    'club_invite_message_defaults',
    'club_news',
    'club_news_competition_ids',
    'club_subscriptions',
    'competition_entries',
    'competition_event_audience',
    'competition_event_operations',
    'competition_match_results',
    'competition_matches',
    'competition_role_invites',
    'competition_role_links',
    'competition_roles',
    'competitions',
    'create_competition_event',
    'default_competition_event_reminder',
    'enforce_photo_storage_prefix',
    'events',
    'game_results',
    'get_competition_role_link_status',
    'guard_external_competition_match_edits',
    'icp_welcome_email_deliveries',
    'inherit_parent_event_scope',
    'is_competition_admin',
    'is_competition_audience',
    'is_competition_member',
    'is_competition_news_admin',
    'is_team_member',
    'notifications',
    'notify_club_news',
    'on_event_auto_chat_post',
    'on_event_cancelled',
    'on_event_created',
    'on_event_updated',
    'on_photo_uploaded',
    'photos',
    'protect_role_folders',
    'send_push_notification',
    'set_notification_club_id',
    'sync_album_aggregates',
    'sync_competition_match_events',
    'team_captains',
    'team_invites',
    'teams',
    'tg_competition_role_sync_chat',
    'tg_competition_role_sync_contact_chats',
    'tg_competition_roles_enforce_owner',
    'tg_photos_mirror_competition_vault',
    'tg_vault_file_stamp_competition',
    'update_club_storage_on_file_change',
    'update_club_storage_on_photo_change',
    'update_updated_at_column',
    'user_roles',
    'validate_club_news_audience',
    'validate_event_duty_team',
    'validate_event_rsvp_grouping',
    'validate_event_target_team_ids',
    'validate_event_team_club_scope',
    'vault_files',
    'vault_folders',
    'welcome_email_deliveries',
    'welcome_email_settings',
    'write_audit_trigger'
]::text[])),
relations AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN (SELECT name FROM requested)
),
report(section, item) AS (
  SELECT 'requested objects', to_jsonb(r) FROM requested r
  UNION ALL
  SELECT 'types', jsonb_build_object('name', t.typname, 'kind', t.typtype,
    'enum_labels', (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
      FROM pg_enum e WHERE e.enumtypid = t.oid))
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typname IN (SELECT name FROM requested)
  UNION ALL
  SELECT 'relations and RLS state', to_jsonb(r) FROM relations r
  UNION ALL
  SELECT 'columns', jsonb_build_object('table', r.relname, 'column', a.attname,
    'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
    'default', pg_get_expr(d.adbin, d.adrelid))
  FROM relations r JOIN pg_attribute a ON a.attrelid = r.oid
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraints', jsonb_build_object('table', r.relname, 'name', c.conname,
    'definition', pg_get_constraintdef(c.oid))
  FROM relations r JOIN pg_constraint c ON c.conrelid = r.oid
  UNION ALL
  SELECT 'indexes', jsonb_build_object('table', r.relname,
    'definition', pg_get_indexdef(i.indexrelid))
  FROM relations r JOIN pg_index i ON i.indrelid = r.oid
  UNION ALL
  SELECT 'policies', to_jsonb(p) FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename IN (SELECT relname FROM relations)
  UNION ALL
  SELECT 'storage policies', to_jsonb(p) FROM pg_policies p
  WHERE p.schemaname = 'storage' AND p.tablename IN ('objects', 'buckets')
  UNION ALL
  SELECT 'table grants', to_jsonb(g) FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public' AND g.table_name IN (SELECT relname FROM relations)
    AND g.grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
  UNION ALL
  SELECT 'triggers', jsonb_build_object('schema', n.nspname, 'table', c.relname,
    'name', t.tgname, 'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND (c.oid IN (SELECT oid FROM relations)
    OR (n.nspname = 'auth' AND c.relname = 'users'))
  UNION ALL
  SELECT 'functions', jsonb_build_object('signature', p.oid::regprocedure::text,
    'definition', pg_get_functiondef(p.oid), 'security_definer', p.prosecdef,
    'settings', p.proconfig, 'privileges', p.proacl)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    AND (p.proname IN (SELECT name FROM requested) OR p.oid IN (
      SELECT t.tgfoid FROM pg_trigger t WHERE NOT t.tgisinternal
        AND (t.tgrelid IN (SELECT oid FROM relations) OR t.tgrelid = 'auth.users'::regclass)
    ))
  UNION ALL
  SELECT 'bucket privacy', jsonb_build_object('id', b.id, 'public', b.public)
  FROM storage.buckets b
  WHERE b.id IN ('competition-vault', 'competition-documents', 'photos', 'chat-attachments')
  UNION ALL
  SELECT 'effective function execution', jsonb_build_object(
    'signature', p.oid::regprocedure::text, 'role', r.rolname,
    'can_execute', has_function_privilege(r.oid, p.oid, 'EXECUTE'))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN pg_roles r
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    AND r.rolname IN ('anon', 'authenticated', 'service_role')
    AND (p.proname IN (SELECT name FROM requested) OR p.oid IN (
      SELECT t.tgfoid FROM pg_trigger t WHERE NOT t.tgisinternal
        AND (t.tgrelid IN (SELECT oid FROM relations) OR t.tgrelid = 'auth.users'::regclass)
    ))
  UNION ALL
  SELECT 'scoped default privileges', jsonb_build_object(
    'owner', pg_get_userbyid(d.defaclrole), 'schema', COALESCE(n.nspname, '(global)'),
    'object_type', d.defaclobjtype,
    'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'privilege', a.privilege_type, 'grantable', a.is_grantable)
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE (n.nspname = 'public' OR d.defaclnamespace = 0)
    AND d.defaclobjtype IN ('r', 'f')
    AND d.defaclrole IN (
      SELECT c.relowner FROM pg_class c WHERE c.oid IN (SELECT oid FROM relations)
      UNION SELECT p.proowner FROM pg_proc p JOIN pg_namespace pn ON pn.oid = p.pronamespace
      WHERE pn.nspname = 'public' AND p.proname IN (SELECT name FROM requested)
    )
    AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'))
  UNION ALL
  SELECT 'named reminder schedules', jsonb_build_object(
    'jobname', j.jobname, 'schedule', j.schedule, 'active', j.active)
  FROM cron.job j
  WHERE j.jobname IN ('process-scheduled-event-reminders', 'auto-rsvp-push-cron', 'chat-photo-gallery-reminders-hourly')

)
SELECT section, count(*) AS object_count, jsonb_agg(item ORDER BY item::text) AS results
FROM report GROUP BY section ORDER BY section;
ROLLBACK;
