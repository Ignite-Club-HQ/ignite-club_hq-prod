-- 1. Authorization helper -------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_event_groups(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND _event_id IS NOT NULL
    AND (
      -- Global app admin (club_id is normally NULL on this role)
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _user_id
          AND ur.role = 'app_admin'::public.app_role
      )
      OR EXISTS (
        SELECT 1
        FROM public.events e
        JOIN public.user_roles ur ON ur.user_id = _user_id
        WHERE e.id = _event_id
          AND ur.club_id = e.club_id
          AND (
            ur.role IN (
              'club_admin'::public.app_role,
              'committee_member'::public.app_role,
              'league_admin'::public.app_role
            )
            -- Club-scoped (not merely team-scoped) coach, mini-league events only
            OR (
              ur.role = 'coach'::public.app_role
              AND ur.team_id IS NULL
              AND e.mini_league_id IS NOT NULL
            )
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_event_groups(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_event_groups(uuid, uuid) TO authenticated, service_role;

-- 2. Player / event scope helper -------------------------------------------
CREATE OR REPLACE FUNCTION public.event_group_player_scope_ok(_group_id uuid, _player_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_groups eg
    JOIN public.events e ON e.id = eg.event_id
    JOIN public.mini_league_players mlp ON mlp.id = _player_id
    JOIN public.mini_leagues ml ON ml.id = mlp.mini_league_id
    WHERE eg.id = _group_id
      AND (
        CASE
          WHEN e.mini_league_id IS NOT NULL
            THEN mlp.mini_league_id = e.mini_league_id
          ELSE ml.club_id = e.club_id
        END
      )
  );
$$;

REVOKE ALL ON FUNCTION public.event_group_player_scope_ok(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.event_group_player_scope_ok(uuid, uuid) TO authenticated, service_role;

-- 3. event_groups policies --------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage event groups" ON public.event_groups;

CREATE POLICY "Managers can insert event groups"
  ON public.event_groups FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_event_groups(auth.uid(), event_id));

CREATE POLICY "Managers can update event groups"
  ON public.event_groups FOR UPDATE TO authenticated
  USING (public.can_manage_event_groups(auth.uid(), event_id))
  WITH CHECK (public.can_manage_event_groups(auth.uid(), event_id));

CREATE POLICY "Managers can delete event groups"
  ON public.event_groups FOR DELETE TO authenticated
  USING (public.can_manage_event_groups(auth.uid(), event_id));

-- 4. event_group_players policies -------------------------------------------
DROP POLICY IF EXISTS "Admins can manage event group players" ON public.event_group_players;

CREATE POLICY "Managers can insert event group players"
  ON public.event_group_players FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.event_groups eg
      WHERE eg.id = event_group_players.group_id
        AND public.can_manage_event_groups(auth.uid(), eg.event_id)
    )
    AND public.event_group_player_scope_ok(event_group_players.group_id, event_group_players.player_id)
  );

CREATE POLICY "Managers can update event group players"
  ON public.event_group_players FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.event_groups eg
      WHERE eg.id = event_group_players.group_id
        AND public.can_manage_event_groups(auth.uid(), eg.event_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.event_groups eg
      WHERE eg.id = event_group_players.group_id
        AND public.can_manage_event_groups(auth.uid(), eg.event_id)
    )
    AND public.event_group_player_scope_ok(event_group_players.group_id, event_group_players.player_id)
  );

CREATE POLICY "Managers can delete event group players"
  ON public.event_group_players FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.event_groups eg
      WHERE eg.id = event_group_players.group_id
        AND public.can_manage_event_groups(auth.uid(), eg.event_id)
    )
  );

-- 5. event_group_duties: same management contract ---------------------------
DROP POLICY IF EXISTS "Admins can manage event group duties" ON public.event_group_duties;

CREATE POLICY "Managers can manage event group duties"
  ON public.event_group_duties FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.event_groups eg
      WHERE eg.id = event_group_duties.group_id
        AND public.can_manage_event_groups(auth.uid(), eg.event_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.event_groups eg
      WHERE eg.id = event_group_duties.group_id
        AND public.can_manage_event_groups(auth.uid(), eg.event_id)
    )
  );