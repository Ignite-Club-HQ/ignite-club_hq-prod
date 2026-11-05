
-- ============================================================
-- PHASE A: Indexes on RLS-filtered columns (60 indexes)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_app_ad_analytics_user_id ON public.app_ad_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_messages_author_id ON public.broadcast_messages(author_id);
CREATE INDEX IF NOT EXISTS idx_business_matches_club_id ON public.business_matches(club_id);
CREATE INDEX IF NOT EXISTS idx_business_profiles_user_id ON public.business_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_groups_created_by ON public.chat_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_chat_photo_gallery_reminders_author_id ON public.chat_photo_gallery_reminders(author_id);
CREATE INDEX IF NOT EXISTS idx_child_training_defaults_child_id ON public.child_training_defaults(child_id);
CREATE INDEX IF NOT EXISTS idx_child_training_defaults_created_by ON public.child_training_defaults(created_by);
CREATE INDEX IF NOT EXISTS idx_child_training_defaults_user_id ON public.child_training_defaults(user_id);
CREATE INDEX IF NOT EXISTS idx_class_attendance_child_id ON public.class_attendance(child_id);
CREATE INDEX IF NOT EXISTS idx_class_attendance_team_id ON public.class_attendance(team_id);
CREATE INDEX IF NOT EXISTS idx_class_attendance_user_id ON public.class_attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_client_perf_log_user_id ON public.client_perf_log(user_id);
CREATE INDEX IF NOT EXISTS idx_club_invites_club_id ON public.club_invites(club_id);
CREATE INDEX IF NOT EXISTS idx_club_join_requests_user_id ON public.club_join_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_club_messages_author_id ON public.club_messages(author_id);
CREATE INDEX IF NOT EXISTS idx_clubs_created_by ON public.clubs(created_by);
CREATE INDEX IF NOT EXISTS idx_competitions_created_by ON public.competitions(created_by);
CREATE INDEX IF NOT EXISTS idx_eoi_form_views_club_id ON public.eoi_form_views(club_id);
CREATE INDEX IF NOT EXISTS idx_event_payments_user_id ON public.event_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON public.feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_file_deletion_logs_club_id ON public.file_deletion_logs(club_id);
CREATE INDEX IF NOT EXISTS idx_game_summaries_user_id ON public.game_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_author_id ON public.group_messages(author_id);
CREATE INDEX IF NOT EXISTS idx_match_goalkeepers_user_id ON public.match_goalkeepers(user_id);
CREATE INDEX IF NOT EXISTS idx_match_message_reads_user_id ON public.match_message_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_match_messages_sender_id ON public.match_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_member_referrals_team_id ON public.member_referrals(team_id);
CREATE INDEX IF NOT EXISTS idx_member_subscription_payments_club_id ON public.member_subscription_payments(club_id);
CREATE INDEX IF NOT EXISTS idx_notifications_club_id ON public.notifications(club_id);
CREATE INDEX IF NOT EXISTS idx_pending_invites_club_id ON public.pending_invites(club_id);
CREATE INDEX IF NOT EXISTS idx_pending_invites_team_id ON public.pending_invites(team_id);
CREATE INDEX IF NOT EXISTS idx_photo_comment_reactions_user_id ON public.photo_comment_reactions(user_id);
CREATE INDEX IF NOT EXISTS idx_photo_comments_user_id ON public.photo_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_photo_deletion_logs_club_id ON public.photo_deletion_logs(club_id);
CREATE INDEX IF NOT EXISTS idx_photo_reactions_user_id ON public.photo_reactions(user_id);
CREATE INDEX IF NOT EXISTS idx_pitch_formations_team_id ON public.pitch_formations(team_id);
CREATE INDEX IF NOT EXISTS idx_pitch_formations_user_id ON public.pitch_formations(user_id);
CREATE INDEX IF NOT EXISTS idx_player_of_match_user_id ON public.player_of_match(user_id);
CREATE INDEX IF NOT EXISTS idx_points_history_created_by ON public.points_history(created_by);
CREATE INDEX IF NOT EXISTS idx_promo_codes_club_id ON public.promo_codes(club_id);
CREATE INDEX IF NOT EXISTS idx_realtime_perf_samples_user_id ON public.realtime_perf_samples(user_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_club_id ON public.reward_redemptions(club_id);
CREATE INDEX IF NOT EXISTS idx_role_requests_club_id ON public.role_requests(club_id);
CREATE INDEX IF NOT EXISTS idx_role_requests_team_id ON public.role_requests(team_id);
CREATE INDEX IF NOT EXISTS idx_role_requests_user_id ON public.role_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_rsvp_audit_log_club_id ON public.rsvp_audit_log(club_id);
CREATE INDEX IF NOT EXISTS idx_rsvp_audit_log_team_id ON public.rsvp_audit_log(team_id);
CREATE INDEX IF NOT EXISTS idx_saved_locations_user_id ON public.saved_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_analytics_user_id ON public.sponsor_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_team_creation_requests_club_id ON public.team_creation_requests(club_id);
CREATE INDEX IF NOT EXISTS idx_team_folders_club_id ON public.team_folders(club_id);
CREATE INDEX IF NOT EXISTS idx_team_folders_team_id ON public.team_folders(team_id);
CREATE INDEX IF NOT EXISTS idx_team_invites_created_by ON public.team_invites(created_by);
CREATE INDEX IF NOT EXISTS idx_team_invites_team_id ON public.team_invites(team_id);
CREATE INDEX IF NOT EXISTS idx_team_messages_author_id ON public.team_messages(author_id);
CREATE INDEX IF NOT EXISTS idx_team_player_positions_user_id ON public.team_player_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_id ON public.user_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_drive_links_created_by ON public.vault_drive_links(created_by);
CREATE INDEX IF NOT EXISTS idx_web_vitals_user_id ON public.web_vitals(user_id);

-- ============================================================
-- PHASE B: Wrap auth.uid() / auth.jwt() / auth.role() with
-- (select ...) in every public-schema policy so Postgres
-- evaluates them once per query instead of once per row.
-- Idempotent: skips policies that are already wrapped.
-- ============================================================
DO $mig$
DECLARE
  r record;
  new_qual text;
  new_check text;
  sql text;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname, p.polname,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS wcheck
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  LOOP
    new_qual := r.qual;
    new_check := r.wcheck;

    IF new_qual IS NOT NULL THEN
      new_qual := regexp_replace(new_qual, '\(\s*SELECT\s+auth\.uid\(\)[^)]*\)',  '__WUID__',  'gi');
      new_qual := regexp_replace(new_qual, '\(\s*SELECT\s+auth\.jwt\(\)[^)]*\)',  '__WJWT__',  'gi');
      new_qual := regexp_replace(new_qual, '\(\s*SELECT\s+auth\.role\(\)[^)]*\)', '__WROLE__', 'gi');
      new_qual := regexp_replace(new_qual, 'auth\.uid\(\)',  '(select auth.uid())',  'g');
      new_qual := regexp_replace(new_qual, 'auth\.jwt\(\)',  '(select auth.jwt())',  'g');
      new_qual := regexp_replace(new_qual, 'auth\.role\(\)', '(select auth.role())', 'g');
      new_qual := replace(new_qual, '__WUID__',  '(select auth.uid())');
      new_qual := replace(new_qual, '__WJWT__',  '(select auth.jwt())');
      new_qual := replace(new_qual, '__WROLE__', '(select auth.role())');
    END IF;

    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(new_check, '\(\s*SELECT\s+auth\.uid\(\)[^)]*\)',  '__WUID__',  'gi');
      new_check := regexp_replace(new_check, '\(\s*SELECT\s+auth\.jwt\(\)[^)]*\)',  '__WJWT__',  'gi');
      new_check := regexp_replace(new_check, '\(\s*SELECT\s+auth\.role\(\)[^)]*\)', '__WROLE__', 'gi');
      new_check := regexp_replace(new_check, 'auth\.uid\(\)',  '(select auth.uid())',  'g');
      new_check := regexp_replace(new_check, 'auth\.jwt\(\)',  '(select auth.jwt())',  'g');
      new_check := regexp_replace(new_check, 'auth\.role\(\)', '(select auth.role())', 'g');
      new_check := replace(new_check, '__WUID__',  '(select auth.uid())');
      new_check := replace(new_check, '__WJWT__',  '(select auth.jwt())');
      new_check := replace(new_check, '__WROLE__', '(select auth.role())');
    END IF;

    IF new_qual IS NOT DISTINCT FROM r.qual
       AND new_check IS NOT DISTINCT FROM r.wcheck THEN
      CONTINUE;
    END IF;

    sql := format('ALTER POLICY %I ON %I.%I', r.polname, r.nspname, r.relname);
    IF new_qual IS NOT NULL THEN
      sql := sql || ' USING (' || new_qual || ')';
    END IF;
    IF new_check IS NOT NULL THEN
      sql := sql || ' WITH CHECK (' || new_check || ')';
    END IF;
    EXECUTE sql;
  END LOOP;
END
$mig$;
