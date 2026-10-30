ALTER TABLE public.chat_groups ADD COLUMN IF NOT EXISTS include_captains boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_group_captain_member(_user_id uuid, _group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_groups cg
    JOIN public.team_captains tc ON tc.user_id = _user_id
    JOIN public.teams t ON t.id = tc.team_id AND t.deleted_at IS NULL
    WHERE cg.id = _group_id AND cg.include_captains = true AND cg.membership_mode = 'role'
      AND cg.mini_league_id IS NULL
      AND ( (cg.team_id IS NOT NULL AND tc.team_id = cg.team_id)
         OR (cg.team_id IS NULL AND cg.club_id IS NOT NULL AND t.club_id = cg.club_id) )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_group_captain_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_group_captain_member(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_group_captain_user_ids(_group_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT tc.user_id FROM public.chat_groups cg
  JOIN public.teams t ON t.deleted_at IS NULL
   AND ((cg.team_id IS NOT NULL AND t.id = cg.team_id) OR (cg.team_id IS NULL AND t.club_id = cg.club_id))
  JOIN public.team_captains tc ON tc.team_id = t.id
  WHERE cg.id = _group_id AND cg.include_captains = true AND cg.membership_mode = 'role'
    AND cg.mini_league_id IS NULL AND tc.user_id IS NOT NULL
    AND (auth.uid() IS NULL OR public.can_access_chat_group(auth.uid(), _group_id));
$$;
REVOKE EXECUTE ON FUNCTION public.get_group_captain_user_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_captain_user_ids(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_chat_group(_user_id uuid, _group_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_groups cg
    WHERE cg.id = _group_id
      AND (
        (cg.club_id IS NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL AND EXISTS (
          SELECT 1 FROM public.group_members gm WHERE gm.group_id = cg.id AND gm.user_id = _user_id))
        OR (
          cg.membership_mode = 'manual'
          AND (cg.club_id IS NOT NULL OR cg.team_id IS NOT NULL OR cg.mini_league_id IS NOT NULL)
          AND (
            EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = cg.id AND gm.user_id = _user_id)
            OR EXISTS (SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = _user_id AND ur.role IN ('club_admin','app_admin')
                AND ((cg.club_id IS NOT NULL AND ur.club_id = cg.club_id) OR ur.role = 'app_admin'))))
        OR (
          cg.membership_mode = 'role'
          AND cg.club_id IS NOT NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL
          AND EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id AND ur.club_id = cg.club_id AND ur.role = ANY(cg.allowed_roles)))
        OR (
          cg.membership_mode = 'role' AND cg.team_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id AND ur.team_id = cg.team_id AND ur.role = ANY(cg.allowed_roles)))
        OR (
          cg.membership_mode = 'role' AND cg.include_captains = true AND cg.mini_league_id IS NULL
          AND EXISTS (SELECT 1 FROM public.team_captains tc
            JOIN public.teams t ON t.id = tc.team_id AND t.deleted_at IS NULL
            WHERE tc.user_id = _user_id
              AND ((cg.team_id IS NOT NULL AND tc.team_id = cg.team_id)
                OR (cg.team_id IS NULL AND cg.club_id IS NOT NULL AND t.club_id = cg.club_id))))
        OR (
          cg.membership_mode = 'role' AND cg.mini_league_id IS NOT NULL
          AND (
            EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.mini_leagues ml ON ml.club_id = ur.club_id
              WHERE ml.id = cg.mini_league_id AND ur.user_id = _user_id AND ur.role IN ('league_admin','club_admin','app_admin'))
            OR EXISTS (SELECT 1 FROM public.mini_league_admins mla WHERE mla.mini_league_id = cg.mini_league_id AND mla.user_id = _user_id)
            OR EXISTS (SELECT 1 FROM public.mini_league_players mlp WHERE mlp.mini_league_id = cg.mini_league_id AND mlp.parent_user_id = _user_id)
            OR EXISTS (SELECT 1 FROM public.child_mini_league_assignments cma JOIN public.children c ON c.id = cma.child_id
              WHERE cma.mini_league_id = cg.mini_league_id AND c.parent_id = _user_id)
            OR EXISTS (SELECT 1 FROM public.child_mini_league_assignments cma JOIN public.child_guardians cgu ON cgu.child_id = cma.child_id
              WHERE cma.mini_league_id = cg.mini_league_id AND cgu.guardian_id = _user_id)
            OR EXISTS (SELECT 1 FROM public.mini_league_players mlp JOIN public.children c ON c.id = mlp.child_id
              WHERE mlp.mini_league_id = cg.mini_league_id AND c.parent_id = _user_id)
            OR EXISTS (SELECT 1 FROM public.mini_league_players mlp JOIN public.child_guardians cgu ON cgu.child_id = mlp.child_id
              WHERE mlp.mini_league_id = cg.mini_league_id AND cgu.guardian_id = _user_id))))
  )
$function$;