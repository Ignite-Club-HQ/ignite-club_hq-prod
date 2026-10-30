-- Consolidate rsvps RLS: write policies should not fire on SELECT.
-- The dedicated "Users can view RSVPs for events they can see" policy already
-- covers all read access. Splitting FOR ALL into FOR INSERT/UPDATE/DELETE
-- removes 4 redundant multi-join EXISTS evaluations per row on every read.

DROP POLICY IF EXISTS "Admins can manage RSVPs" ON public.rsvps;
DROP POLICY IF EXISTS "Admins can manage mini league player RSVPs" ON public.rsvps;
DROP POLICY IF EXISTS "Guardians can manage child RSVPs" ON public.rsvps;
DROP POLICY IF EXISTS "Parents can manage their league player RSVPs" ON public.rsvps;
DROP POLICY IF EXISTS "Users can manage their own RSVPs" ON public.rsvps;

-- ===== Self (own RSVP) =====
CREATE POLICY "Users can insert their own RSVPs" ON public.rsvps
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Users can update their own RSVPs" ON public.rsvps
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Users can delete their own RSVPs" ON public.rsvps
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

-- ===== Guardians (child RSVPs) =====
CREATE POLICY "Guardians can insert child RSVPs" ON public.rsvps
  FOR INSERT TO authenticated
  WITH CHECK (
    child_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM child_guardians cg
      WHERE cg.child_id = rsvps.child_id
        AND cg.guardian_id = (select auth.uid())
    )
  );

CREATE POLICY "Guardians can update child RSVPs" ON public.rsvps
  FOR UPDATE TO authenticated
  USING (
    child_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM child_guardians cg
      WHERE cg.child_id = rsvps.child_id
        AND cg.guardian_id = (select auth.uid())
    )
  )
  WITH CHECK (
    child_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM child_guardians cg
      WHERE cg.child_id = rsvps.child_id
        AND cg.guardian_id = (select auth.uid())
    )
  );

CREATE POLICY "Guardians can delete child RSVPs" ON public.rsvps
  FOR DELETE TO authenticated
  USING (
    child_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM child_guardians cg
      WHERE cg.child_id = rsvps.child_id
        AND cg.guardian_id = (select auth.uid())
    )
  );

-- ===== Parents (mini-league player RSVPs) =====
CREATE POLICY "Parents can insert league player RSVPs" ON public.rsvps
  FOR INSERT TO authenticated
  WITH CHECK (
    mini_league_player_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM mini_league_players mlp
      WHERE mlp.id = rsvps.mini_league_player_id
        AND mlp.parent_user_id = (select auth.uid())
    )
  );

CREATE POLICY "Parents can update league player RSVPs" ON public.rsvps
  FOR UPDATE TO authenticated
  USING (
    mini_league_player_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM mini_league_players mlp
      WHERE mlp.id = rsvps.mini_league_player_id
        AND mlp.parent_user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    mini_league_player_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM mini_league_players mlp
      WHERE mlp.id = rsvps.mini_league_player_id
        AND mlp.parent_user_id = (select auth.uid())
    )
  );

CREATE POLICY "Parents can delete league player RSVPs" ON public.rsvps
  FOR DELETE TO authenticated
  USING (
    mini_league_player_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM mini_league_players mlp
      WHERE mlp.id = rsvps.mini_league_player_id
        AND mlp.parent_user_id = (select auth.uid())
    )
  );

-- ===== Admins (event-scoped: club_admin / team_admin / coach) =====
CREATE POLICY "Admins can insert RSVPs" ON public.rsvps
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = rsvps.event_id
        AND (
          has_role((select auth.uid()), 'club_admin'::app_role, e.club_id, NULL::uuid)
          OR has_role((select auth.uid()), 'team_admin'::app_role, NULL::uuid, e.team_id)
          OR has_role((select auth.uid()), 'coach'::app_role, NULL::uuid, e.team_id)
        )
    )
  );

CREATE POLICY "Admins can update RSVPs" ON public.rsvps
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = rsvps.event_id
        AND (
          has_role((select auth.uid()), 'club_admin'::app_role, e.club_id, NULL::uuid)
          OR has_role((select auth.uid()), 'team_admin'::app_role, NULL::uuid, e.team_id)
          OR has_role((select auth.uid()), 'coach'::app_role, NULL::uuid, e.team_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = rsvps.event_id
        AND (
          has_role((select auth.uid()), 'club_admin'::app_role, e.club_id, NULL::uuid)
          OR has_role((select auth.uid()), 'team_admin'::app_role, NULL::uuid, e.team_id)
          OR has_role((select auth.uid()), 'coach'::app_role, NULL::uuid, e.team_id)
        )
    )
  );

CREATE POLICY "Admins can delete RSVPs" ON public.rsvps
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = rsvps.event_id
        AND (
          has_role((select auth.uid()), 'club_admin'::app_role, e.club_id, NULL::uuid)
          OR has_role((select auth.uid()), 'team_admin'::app_role, NULL::uuid, e.team_id)
          OR has_role((select auth.uid()), 'coach'::app_role, NULL::uuid, e.team_id)
        )
    )
  );

-- ===== Admins (mini-league player RSVPs: club_admin / team_admin / coach in same club) =====
CREATE POLICY "Admins can insert mini league player RSVPs" ON public.rsvps
  FOR INSERT TO authenticated
  WITH CHECK (
    mini_league_player_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM mini_league_players mlp
        JOIN mini_leagues ml ON ml.id = mlp.mini_league_id
        JOIN user_roles ur ON ur.club_id = ml.club_id
      WHERE mlp.id = rsvps.mini_league_player_id
        AND ur.user_id = (select auth.uid())
        AND ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role])
    )
  );

CREATE POLICY "Admins can update mini league player RSVPs" ON public.rsvps
  FOR UPDATE TO authenticated
  USING (
    mini_league_player_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM mini_league_players mlp
        JOIN mini_leagues ml ON ml.id = mlp.mini_league_id
        JOIN user_roles ur ON ur.club_id = ml.club_id
      WHERE mlp.id = rsvps.mini_league_player_id
        AND ur.user_id = (select auth.uid())
        AND ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role])
    )
  )
  WITH CHECK (
    mini_league_player_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM mini_league_players mlp
        JOIN mini_leagues ml ON ml.id = mlp.mini_league_id
        JOIN user_roles ur ON ur.club_id = ml.club_id
      WHERE mlp.id = rsvps.mini_league_player_id
        AND ur.user_id = (select auth.uid())
        AND ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role])
    )
  );

CREATE POLICY "Admins can delete mini league player RSVPs" ON public.rsvps
  FOR DELETE TO authenticated
  USING (
    mini_league_player_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM mini_league_players mlp
        JOIN mini_leagues ml ON ml.id = mlp.mini_league_id
        JOIN user_roles ur ON ur.club_id = ml.club_id
      WHERE mlp.id = rsvps.mini_league_player_id
        AND ur.user_id = (select auth.uid())
        AND ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role])
    )
  );