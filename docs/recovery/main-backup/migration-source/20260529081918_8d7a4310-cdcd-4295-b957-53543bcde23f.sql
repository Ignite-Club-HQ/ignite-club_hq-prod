-- ============================================================
-- Safe RLS perf pass: wrap auth.uid() in (SELECT auth.uid())
-- Pure rewrites, no semantics change, fully reversible.
-- ============================================================

-- ---------- profiles ----------
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "App admins can view all profiles" ON public.profiles;
CREATE POLICY "App admins can view all profiles"
ON public.profiles FOR SELECT
USING (has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid));

DROP POLICY IF EXISTS "App admins can update any profile" ON public.profiles;
CREATE POLICY "App admins can update any profile"
ON public.profiles FOR UPDATE
USING (has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid));

DROP POLICY IF EXISTS "DM participants can view each other profiles" ON public.profiles;
CREATE POLICY "DM participants can view each other profiles"
ON public.profiles FOR SELECT
USING (EXISTS (
  SELECT 1 FROM direct_conversations dc
  WHERE ((dc.participant_1 = (SELECT auth.uid()) AND dc.participant_2 = profiles.id)
      OR (dc.participant_2 = (SELECT auth.uid()) AND dc.participant_1 = profiles.id))
));

DROP POLICY IF EXISTS "Users can view profiles of photo uploaders in shared clubs/team" ON public.profiles;
CREATE POLICY "Users can view profiles of photo uploaders in shared clubs/team"
ON public.profiles FOR SELECT
USING (is_photo_uploader_visible((SELECT auth.uid()), id));

DROP POLICY IF EXISTS "Users can view profiles of club chat message authors" ON public.profiles;
CREATE POLICY "Users can view profiles of club chat message authors"
ON public.profiles FOR SELECT
USING (is_club_chat_author_visible((SELECT auth.uid()), id));

DROP POLICY IF EXISTS "Users can view profiles of photo commenters in shared clubs/tea" ON public.profiles;
CREATE POLICY "Users can view profiles of photo commenters in shared clubs/tea"
ON public.profiles FOR SELECT
USING (is_photo_commenter_visible((SELECT auth.uid()), id));

DROP POLICY IF EXISTS "Users can view profiles of users they share a team/club with" ON public.profiles;
CREATE POLICY "Users can view profiles of users they share a team/club with"
ON public.profiles FOR SELECT
USING (shares_team_or_club_with((SELECT auth.uid()), id));

-- ---------- chat_groups ----------
DROP POLICY IF EXISTS "Creators can manage their groups" ON public.chat_groups;
CREATE POLICY "Creators can manage their groups"
ON public.chat_groups FOR ALL
USING (created_by = (SELECT auth.uid()))
WITH CHECK (created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view accessible groups" ON public.chat_groups;
CREATE POLICY "Users can view accessible groups"
ON public.chat_groups FOR SELECT
USING (deleted_at IS NULL AND (created_by = (SELECT auth.uid()) OR can_access_chat_group((SELECT auth.uid()), id)));

DROP POLICY IF EXISTS "App admins can view all chat groups" ON public.chat_groups;
CREATE POLICY "App admins can view all chat groups"
ON public.chat_groups FOR SELECT
USING (has_role((SELECT auth.uid()), 'app_admin'::app_role));

DROP POLICY IF EXISTS "App admins can delete any chat group" ON public.chat_groups;
CREATE POLICY "App admins can delete any chat group"
ON public.chat_groups FOR DELETE
USING (has_role((SELECT auth.uid()), 'app_admin'::app_role));

DROP POLICY IF EXISTS "App admins can manage all chat groups" ON public.chat_groups;
CREATE POLICY "App admins can manage all chat groups"
ON public.chat_groups FOR UPDATE
USING (has_role((SELECT auth.uid()), 'app_admin'::app_role))
WITH CHECK (has_role((SELECT auth.uid()), 'app_admin'::app_role));

DROP POLICY IF EXISTS "Users can access mini league chats" ON public.chat_groups;
CREATE POLICY "Users can access mini league chats"
ON public.chat_groups FOR SELECT
USING (deleted_at IS NULL AND mini_league_id IS NOT NULL AND can_access_chat_group((SELECT auth.uid()), id));

DROP POLICY IF EXISTS "Club members can discover open groups" ON public.chat_groups;
CREATE POLICY "Club members can discover open groups"
ON public.chat_groups FOR SELECT
USING (
  deleted_at IS NULL
  AND join_policy = 'open_to_club'
  AND club_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = (SELECT auth.uid()) AND ur.club_id = chat_groups.club_id
  )
);

DROP POLICY IF EXISTS "Club admins can view deleted club chat groups" ON public.chat_groups;
CREATE POLICY "Club admins can view deleted club chat groups"
ON public.chat_groups FOR SELECT
USING (
  deleted_at IS NOT NULL
  AND club_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.club_id = chat_groups.club_id
      AND user_roles.role = 'club_admin'::app_role
  )
);

DROP POLICY IF EXISTS "Club admins can restore deleted club chat groups" ON public.chat_groups;
CREATE POLICY "Club admins can restore deleted club chat groups"
ON public.chat_groups FOR UPDATE
USING (
  club_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.club_id = chat_groups.club_id
      AND user_roles.role = 'club_admin'::app_role
  )
)
WITH CHECK (
  club_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.club_id = chat_groups.club_id
      AND user_roles.role = 'club_admin'::app_role
  )
);

-- ---------- events ----------
DROP POLICY IF EXISTS "Members can view events" ON public.events;
CREATE POLICY "Members can view events"
ON public.events FOR SELECT
USING (
  ((mini_league_id IS NOT NULL) AND (
       has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
    OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
    OR has_role((SELECT auth.uid()), 'league_admin'::app_role, club_id, NULL::uuid)
    OR EXISTS (SELECT 1 FROM mini_league_admins mla WHERE mla.mini_league_id = events.mini_league_id AND mla.user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM mini_league_players mlp WHERE mlp.mini_league_id = events.mini_league_id AND mlp.parent_user_id = (SELECT auth.uid()))
  ))
  OR ((mini_league_id IS NULL) AND (team_id IS NULL) AND is_club_member((SELECT auth.uid()), club_id))
  OR ((team_id IS NOT NULL) AND (
       is_team_member((SELECT auth.uid()), team_id)
    OR has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
    OR has_role((SELECT auth.uid()), 'app_admin'::app_role, NULL::uuid, NULL::uuid)
  ))
);

DROP POLICY IF EXISTS "Admins/coaches can create events" ON public.events;
CREATE POLICY "Admins/coaches can create events"
ON public.events FOR INSERT
WITH CHECK (
     has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role((SELECT auth.uid()), 'coach'::app_role, NULL::uuid, team_id)
  OR ((mini_league_id IS NOT NULL) AND has_role((SELECT auth.uid()), 'league_admin'::app_role, club_id, NULL::uuid))
  OR ((mini_league_id IS NOT NULL) AND has_role((SELECT auth.uid()), 'coach'::app_role, club_id, NULL::uuid))
  OR (has_role((SELECT auth.uid()), 'committee_member'::app_role, club_id, NULL::uuid) AND type = 'social'::event_type AND team_id IS NULL)
);

DROP POLICY IF EXISTS "Admins/coaches can update events" ON public.events;
CREATE POLICY "Admins/coaches can update events"
ON public.events FOR UPDATE
USING (
     has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role((SELECT auth.uid()), 'coach'::app_role, NULL::uuid, team_id)
  OR ((mini_league_id IS NOT NULL) AND has_role((SELECT auth.uid()), 'league_admin'::app_role, club_id, NULL::uuid))
  OR ((mini_league_id IS NOT NULL) AND has_role((SELECT auth.uid()), 'coach'::app_role, club_id, NULL::uuid))
  OR (has_role((SELECT auth.uid()), 'committee_member'::app_role, club_id, NULL::uuid) AND type = 'social'::event_type AND team_id IS NULL)
);

DROP POLICY IF EXISTS "Admins/coaches can delete events" ON public.events;
CREATE POLICY "Admins/coaches can delete events"
ON public.events FOR DELETE
USING (
     has_role((SELECT auth.uid()), 'club_admin'::app_role, club_id, NULL::uuid)
  OR has_role((SELECT auth.uid()), 'team_admin'::app_role, NULL::uuid, team_id)
  OR has_role((SELECT auth.uid()), 'coach'::app_role, NULL::uuid, team_id)
  OR ((mini_league_id IS NOT NULL) AND has_role((SELECT auth.uid()), 'league_admin'::app_role, club_id, NULL::uuid))
  OR ((mini_league_id IS NOT NULL) AND has_role((SELECT auth.uid()), 'coach'::app_role, club_id, NULL::uuid))
  OR (has_role((SELECT auth.uid()), 'committee_member'::app_role, club_id, NULL::uuid) AND type = 'social'::event_type AND team_id IS NULL)
);

-- ---------- children ----------
DROP POLICY IF EXISTS "Parents can manage own children" ON public.children;
CREATE POLICY "Parents can manage own children"
ON public.children FOR ALL
USING (parent_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Parents can view own children" ON public.children;
CREATE POLICY "Parents can view own children"
ON public.children FOR SELECT
USING (parent_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view children on their teams" ON public.children;
CREATE POLICY "Admins can view children on their teams"
ON public.children FOR SELECT
USING (can_admin_view_child(id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can update children on their teams" ON public.children;
CREATE POLICY "Admins can update children on their teams"
ON public.children FOR UPDATE
USING (can_admin_view_child(id, (SELECT auth.uid())))
WITH CHECK (can_admin_view_child(id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Guardians can view linked children" ON public.children;
CREATE POLICY "Guardians can view linked children"
ON public.children FOR SELECT
USING (is_guardian_of_child((SELECT auth.uid()), id));

DROP POLICY IF EXISTS "Team members can view children on their teams" ON public.children;
CREATE POLICY "Team members can view children on their teams"
ON public.children FOR SELECT
USING (can_view_child_via_team(id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can create children for team members" ON public.children;
CREATE POLICY "Admins can create children for team members"
ON public.children FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM user_roles ur
  WHERE ur.user_id = (SELECT auth.uid())
    AND ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role, 'app_admin'::app_role])
));