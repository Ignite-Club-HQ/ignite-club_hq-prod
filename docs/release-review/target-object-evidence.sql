-- READ ONLY: run in the approved PROD SQL Editor, export the single result.
-- No application records, routing values, auth accounts or scheduler commands.
-- Function definitions/default expressions can contain embedded secrets: review before sharing.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
WITH requested(name) AS (SELECT unnest(ARRAY[
    'accept_competition_role_email_invite',
    'accept_competition_role_link',
    'app_role',
    'app_settings',
    'auto_claim_eois_by_email',
    'can_access_competition_vault',
    'can_access_targeted_event',
    'can_invite_players_to_team',
    'can_manage_competition_vault',
    'can_manage_game_result',
    'can_manage_team_roster',
    'can_read_history_row',
    'can_view_competition',
    'can_view_competition_fixture_event',
    'can_view_mini_league',
    'can_view_pending_role_request_profile',
    'canister_memory_reports',
    'chat_groups',
    'child_guardians',
    'child_team_assignments',
    'children',
    'claim_competition_role_invites_on_profile_create',
    'claim_icp_welcome_email',
    'claim_welcome_email_delivery',
    'club_dm_settings',
    'club_invite_message_defaults',
    'club_invites',
    'club_is_paid',
    'club_news',
    'club_news_competition_ids',
    'club_players',
    'club_subscriptions',
    'clubs',
    'competition_divisions',
    'competition_entries',
    'competition_event_operations',
    'competition_ladder',
    'competition_match_results',
    'competition_matches',
    'competition_pending_scores',
    'competition_role_email_invites',
    'competition_role_invites',
    'competition_role_links',
    'competition_roles',
    'competition_scores_visible',
    'competition_vault_storage_access',
    'competitions',
    'create_competition_event',
    'create_competition_role_email_invite',
    'direct_conversations',
    'direct_messages',
    'duties',
    'email_signup_invite_allowed',
    'enqueue_scheduled_event_notice',
    'ensure_competition_admin_thread',
    'event_reminder_recipient_ids',
    'event_type',
    'events',
    'finish_icp_welcome_email',
    'finish_legacy_competition_scores',
    'finish_welcome_email_delivery',
    'game_player_stats',
    'game_results',
    'game_summaries',
    'get_competition_role_email_invite_status',
    'get_competition_role_link_status',
    'get_my_viewable_competition_match_ids',
    'get_targeted_event_notification_recipients',
    'group_members',
    'guard_competition_owner_delete',
    'guard_external_competition_match_edits',
    'handle_new_user',
    'has_role',
    'history_result_dto',
    'history_row_scores_visible',
    'history_scores_visible',
    'icp_welcome_email_deliveries',
    'invite_competition_official',
    'is_club_admin_for',
    'is_club_member',
    'is_competition_admin',
    'is_competition_audience',
    'is_competition_media_member',
    'is_competition_news_admin',
    'is_team_member',
    'is_welcome_email_recipient',
    'list_expired_free_media',
    'lock_club_backend',
    'mask_history_players',
    'match_scores_hidden',
    'mini_league_admins',
    'mini_league_players',
    'mini_leagues',
    'notification_preferences',
    'notifications',
    'notify_competition_news',
    'notify_mini_league_news',
    'pending_invites',
    'photo_views',
    'photos',
    'process_scheduled_event_reminders',
    'profiles',
    'protect_competition_event_scores',
    'protect_competition_game_results',
    'purge_expired_free_media_rows',
    'read_game_history',
    'read_game_result',
    'read_history_player_stats',
    'read_history_report_events',
    'read_history_summary',
    'redirect_legacy_competition_scores',
    'remove_exact_competition_role',
    'revoke_competition_role_email_invite',
    'role_requests',
    'rsvps',
    'save_competition_match_result',
    'save_game_history',
    'send_welcome_dm',
    'sync_competition_match_events',
    'sync_competition_result_to_events',
    'team_captains',
    'team_invites',
    'team_memberships',
    'teams',
    'update_updated_at_column',
    'user_roles',
    'validate_club_news_mini_league_audience',
    'validate_event_duty_team',
    'vault_files',
    'vault_folders',
    'welcome_email_deliveries',
    'welcome_email_settings'
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
)
SELECT section, count(*) AS object_count, jsonb_agg(item ORDER BY item::text) AS results
FROM report GROUP BY section ORDER BY section;
ROLLBACK;

