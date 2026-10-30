DROP FUNCTION IF EXISTS public._probe_gr(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.can_manage_game_result(_user_id uuid, _team_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Team-scoped roles on the result's own team.
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.team_id = _team_id
        AND ur.role IN ('team_admin','coach','club_admin')
    )
    -- Club-level admins/committee (their user_roles row has team_id IS NULL,
    -- so a team_id equality check alone never matched them).
    OR EXISTS (
      SELECT 1
      FROM public.teams t
      JOIN public.user_roles ur ON ur.club_id = t.club_id
      WHERE t.id = _team_id
        AND ur.user_id = _user_id
        AND ur.team_id IS NULL
        AND ur.role IN ('club_admin','committee_member')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.role = 'app_admin'
    )
    OR (_event_id IS NOT NULL AND public.is_subs_manager_for_event(_user_id, _event_id));
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_game_result(uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Admins, coaches and subs manager can save game results" ON public.game_results;
CREATE POLICY "Admins, coaches and subs manager can save game results"
ON public.game_results
FOR INSERT
TO authenticated
WITH CHECK (
  saved_by = (SELECT auth.uid())
  AND public.can_manage_game_result((SELECT auth.uid()), team_id, event_id)
);

DROP POLICY IF EXISTS "Admins, savers and subs manager can update game results" ON public.game_results;
CREATE POLICY "Admins, savers and subs manager can update game results"
ON public.game_results
FOR UPDATE
TO authenticated
USING (
  saved_by = (SELECT auth.uid())
  OR public.can_manage_game_result((SELECT auth.uid()), team_id, event_id)
)
WITH CHECK (
  saved_by = (SELECT auth.uid())
  OR public.can_manage_game_result((SELECT auth.uid()), team_id, event_id)
);

DROP POLICY IF EXISTS "Admins and savers can delete game results" ON public.game_results;
CREATE POLICY "Admins and savers can delete game results"
ON public.game_results
FOR DELETE
TO authenticated
USING (
  saved_by = (SELECT auth.uid())
  OR public.can_manage_game_result((SELECT auth.uid()), team_id, event_id)
);

DROP POLICY IF EXISTS "Team members can view game results" ON public.game_results;
CREATE POLICY "Team members can view game results"
ON public.game_results
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid()) AND ur.team_id = game_results.team_id
  )
  OR public.can_manage_game_result((SELECT auth.uid()), team_id, event_id)
);