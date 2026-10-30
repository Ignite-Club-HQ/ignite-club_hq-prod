CREATE OR REPLACE FUNCTION public.can_invite_players_to_team(_user_id uuid, _team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND _team_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.team_captains tc WHERE tc.team_id = _team_id AND tc.user_id = _user_id)
    OR EXISTS (
      SELECT 1 FROM public.competition_entries ce
      JOIN public.competition_roles cr ON cr.competition_id = ce.competition_id
      WHERE ce.team_id = _team_id AND ce.status = 'accepted'
        AND cr.user_id = _user_id AND cr.role IN ('owner','admin')
    )
  )
$$;
REVOKE ALL ON FUNCTION public.can_invite_players_to_team(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_invite_players_to_team(uuid, uuid) TO authenticated;

CREATE POLICY "Comp admins and captains can create player invite links"
ON public.team_invites FOR INSERT TO authenticated
WITH CHECK (created_by = (SELECT auth.uid()) AND role IN ('player','parent')
  AND public.can_invite_players_to_team((SELECT auth.uid()), team_id));

CREATE POLICY "Comp admins and captains can view player invite links"
ON public.team_invites FOR SELECT TO authenticated
USING (role IN ('player','parent') AND public.can_invite_players_to_team((SELECT auth.uid()), team_id));

CREATE POLICY "Comp admins and captains can add players to team"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (team_id IS NOT NULL AND role IN ('player'::app_role,'parent'::app_role)
  AND club_id = (SELECT t.club_id FROM public.teams t WHERE t.id = user_roles.team_id)
  AND public.can_invite_players_to_team((SELECT auth.uid()), team_id));