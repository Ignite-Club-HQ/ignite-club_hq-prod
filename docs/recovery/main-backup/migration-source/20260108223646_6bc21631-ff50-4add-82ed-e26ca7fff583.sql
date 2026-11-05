-- app_ad_analytics: App admins can manage, users can insert their own views
CREATE POLICY "App admins can manage ad analytics" ON public.app_ad_analytics FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));
CREATE POLICY "Users can insert their own ad views" ON public.app_ad_analytics FOR INSERT
WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- app_ad_settings: App admins only
CREATE POLICY "App admins can manage ad settings" ON public.app_ad_settings FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));
CREATE POLICY "Authenticated users can view ad settings" ON public.app_ad_settings FOR SELECT
USING (auth.uid() IS NOT NULL);

-- app_stripe_config: App admins only
CREATE POLICY "App admins can manage stripe config" ON public.app_stripe_config FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));

-- chat_groups: Members of the club/team with allowed roles
CREATE POLICY "Users can view chat groups they have access to" ON public.chat_groups FOR SELECT
USING (public.can_access_chat_group(auth.uid(), id));
CREATE POLICY "Club/team admins can manage chat groups" ON public.chat_groups FOR ALL
USING (
  (club_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND club_id = chat_groups.club_id AND role = 'club_admin'))
  OR (team_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = chat_groups.team_id AND role IN ('team_admin', 'coach')))
);

-- chat_mute_preferences: Users manage their own
CREATE POLICY "Users can manage their own mute preferences" ON public.chat_mute_preferences FOR ALL
USING (user_id = auth.uid());

-- child_team_assignments: Parents and team admins
CREATE POLICY "Parents can view their children's assignments" ON public.child_team_assignments FOR SELECT
USING (child_id IN (SELECT id FROM children WHERE parent_id = auth.uid()));
CREATE POLICY "Team admins can manage assignments" ON public.child_team_assignments FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = child_team_assignments.team_id AND role IN ('team_admin', 'coach', 'club_admin')));
CREATE POLICY "Parents can insert their children's assignments" ON public.child_team_assignments FOR INSERT
WITH CHECK (child_id IN (SELECT id FROM children WHERE parent_id = auth.uid()));

-- club_invites: Club admins manage
CREATE POLICY "Club admins can manage invites" ON public.club_invites FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND club_id = club_invites.club_id AND role = 'club_admin'));

-- club_stripe_configs: Club admins only
CREATE POLICY "Club admins can manage stripe configs" ON public.club_stripe_configs FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND club_id = club_stripe_configs.club_id AND role = 'club_admin'));

-- event_payments: Users can view their own, admins can manage
CREATE POLICY "Users can view their own payments" ON public.event_payments FOR SELECT
USING (user_id = auth.uid());
CREATE POLICY "Users can insert their own payments" ON public.event_payments FOR INSERT
WITH CHECK (user_id = auth.uid());
CREATE POLICY "Club admins can manage event payments" ON public.event_payments FOR ALL
USING (EXISTS (
  SELECT 1 FROM events e
  JOIN user_roles ur ON ur.club_id = e.club_id AND ur.role = 'club_admin'
  WHERE e.id = event_payments.event_id AND ur.user_id = auth.uid()
));

-- event_sponsors: Team/club members can view, admins can manage
CREATE POLICY "Members can view event sponsors" ON public.event_sponsors FOR SELECT
USING (EXISTS (
  SELECT 1 FROM events e
  LEFT JOIN user_roles ur ON (ur.team_id = e.team_id OR ur.club_id = e.club_id)
  WHERE e.id = event_sponsors.event_id AND ur.user_id = auth.uid()
));
CREATE POLICY "Admins can manage event sponsors" ON public.event_sponsors FOR ALL
USING (EXISTS (
  SELECT 1 FROM events e
  JOIN user_roles ur ON (ur.team_id = e.team_id OR ur.club_id = e.club_id) AND ur.role IN ('team_admin', 'coach', 'club_admin')
  WHERE e.id = event_sponsors.event_id AND ur.user_id = auth.uid()
));

-- favorite_event_titles: Users manage their own
CREATE POLICY "Users can manage their own favorite titles" ON public.favorite_event_titles FOR ALL
USING (user_id = auth.uid());

-- favorite_opponents: Users manage their own
CREATE POLICY "Users can manage their own favorite opponents" ON public.favorite_opponents FOR ALL
USING (user_id = auth.uid());

-- game_player_stats: Team members can view, admins can manage
CREATE POLICY "Team members can view game stats" ON public.game_player_stats FOR SELECT
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = game_player_stats.team_id));
CREATE POLICY "Admins can manage game stats" ON public.game_player_stats FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = game_player_stats.team_id AND role IN ('team_admin', 'coach', 'club_admin')));

-- game_summaries: Team members can view, admins can manage
CREATE POLICY "Team members can view game summaries" ON public.game_summaries FOR SELECT
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = game_summaries.team_id));
CREATE POLICY "Admins can manage game summaries" ON public.game_summaries FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = game_summaries.team_id AND role IN ('team_admin', 'coach', 'club_admin')));

-- member_subscription_payments: Users can view their own, club admins can manage
CREATE POLICY "Users can view their own subscription payments" ON public.member_subscription_payments FOR SELECT
USING (user_id = auth.uid());
CREATE POLICY "Club admins can manage subscription payments" ON public.member_subscription_payments FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND club_id = member_subscription_payments.club_id AND role = 'club_admin'));

-- message_reads: Users manage their own
CREATE POLICY "Users can manage their own message reads" ON public.message_reads FOR ALL
USING (user_id = auth.uid());

-- notification_preferences: Users manage their own
CREATE POLICY "Users can manage their own notification preferences" ON public.notification_preferences FOR ALL
USING (user_id = auth.uid());

-- pending_invites: Inviters and invitees can view, admins can manage
CREATE POLICY "Users can view invites they sent or received" ON public.pending_invites FOR SELECT
USING (invited_by_user_id = auth.uid() OR invited_user_id = auth.uid());
CREATE POLICY "Users can insert pending invites" ON public.pending_invites FOR INSERT
WITH CHECK (invited_by_user_id = auth.uid());
CREATE POLICY "Admins can manage pending invites" ON public.pending_invites FOR ALL
USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = pending_invites.team_id AND role IN ('team_admin', 'coach'))
  OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND club_id = pending_invites.club_id AND role = 'club_admin')
);

-- promo_codes: App admins can manage
CREATE POLICY "App admins can manage promo codes" ON public.promo_codes FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));

-- push_subscriptions: Users manage their own
CREATE POLICY "Users can manage their own push subscriptions" ON public.push_subscriptions FOR ALL
USING (user_id = auth.uid());

-- role_requests: Users can view/manage their own, admins can manage
CREATE POLICY "Users can view their own role requests" ON public.role_requests FOR SELECT
USING (user_id = auth.uid());
CREATE POLICY "Users can insert their own role requests" ON public.role_requests FOR INSERT
WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins can manage role requests" ON public.role_requests FOR ALL
USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'app_admin')
  OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND club_id = role_requests.club_id AND role = 'club_admin')
  OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = role_requests.team_id AND role IN ('team_admin', 'coach'))
);

-- sponsor_analytics: Club admins can view their club's analytics
CREATE POLICY "Club admins can view sponsor analytics" ON public.sponsor_analytics FOR SELECT
USING (EXISTS (
  SELECT 1 FROM sponsors s
  JOIN user_roles ur ON ur.club_id = s.club_id AND ur.role = 'club_admin'
  WHERE s.id = sponsor_analytics.sponsor_id AND ur.user_id = auth.uid()
));
CREATE POLICY "Authenticated users can insert sponsor analytics" ON public.sponsor_analytics FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- team_invites: Team admins manage
CREATE POLICY "Team admins can manage invites" ON public.team_invites FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = team_invites.team_id AND role IN ('team_admin', 'coach', 'club_admin')));

-- team_player_positions: Team members can view, admins can manage
CREATE POLICY "Team members can view player positions" ON public.team_player_positions FOR SELECT
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = team_player_positions.team_id));
CREATE POLICY "Admins can manage player positions" ON public.team_player_positions FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = team_player_positions.team_id AND role IN ('team_admin', 'coach', 'club_admin')));

-- team_sponsors: Team members can view, admins can manage
CREATE POLICY "Team members can view team sponsors" ON public.team_sponsors FOR SELECT
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = team_sponsors.team_id));
CREATE POLICY "Admins can manage team sponsors" ON public.team_sponsors FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND team_id = team_sponsors.team_id AND role IN ('team_admin', 'coach', 'club_admin')));

-- user_passkeys: Users manage their own
CREATE POLICY "Users can manage their own passkeys" ON public.user_passkeys FOR ALL
USING (user_id = auth.uid());

-- vault_files: Based on folder access
CREATE POLICY "Users can view files in accessible folders" ON public.vault_files FOR SELECT
USING (EXISTS (
  SELECT 1 FROM vault_folders vf
  LEFT JOIN user_roles ur ON (ur.team_id = vf.team_id OR ur.club_id = vf.club_id)
  WHERE vf.id = vault_files.folder_id AND ur.user_id = auth.uid()
));
CREATE POLICY "Admins can manage vault files" ON public.vault_files FOR ALL
USING (EXISTS (
  SELECT 1 FROM vault_folders vf
  JOIN user_roles ur ON (ur.team_id = vf.team_id OR ur.club_id = vf.club_id) AND ur.role IN ('team_admin', 'coach', 'club_admin')
  WHERE vf.id = vault_files.folder_id AND ur.user_id = auth.uid()
));

-- vault_folders: Team/club members can view, admins can manage
CREATE POLICY "Members can view vault folders" ON public.vault_folders FOR SELECT
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND (team_id = vault_folders.team_id OR club_id = vault_folders.club_id)));
CREATE POLICY "Admins can manage vault folders" ON public.vault_folders FOR ALL
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND (team_id = vault_folders.team_id OR club_id = vault_folders.club_id) AND role IN ('team_admin', 'coach', 'club_admin')));