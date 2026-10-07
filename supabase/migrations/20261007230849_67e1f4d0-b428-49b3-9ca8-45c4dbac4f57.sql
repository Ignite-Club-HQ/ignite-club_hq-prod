CREATE OR REPLACE FUNCTION public.get_my_accessible_chat_group_ids(_user_id uuid)
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH
  via_membership AS (SELECT gm.group_id AS id FROM public.group_members gm WHERE gm.user_id = _user_id),
  via_club_admin AS (
    SELECT cg.id FROM public.chat_groups cg
    JOIN public.user_roles ur ON ur.user_id = _user_id AND ur.role = 'club_admin'::app_role AND ur.club_id = cg.club_id
    WHERE cg.membership_mode = 'manual' AND cg.club_id IS NOT NULL),
  via_app_admin_manual AS (
    SELECT cg.id FROM public.chat_groups cg
    WHERE cg.membership_mode = 'manual'
      AND (cg.club_id IS NOT NULL OR cg.team_id IS NOT NULL OR cg.mini_league_id IS NOT NULL)
      AND public.has_role(_user_id, 'app_admin'::app_role)),
  via_club_role AS (
    SELECT cg.id FROM public.chat_groups cg
    JOIN public.user_roles ur ON ur.user_id = _user_id AND ur.club_id = cg.club_id AND ur.role = ANY (cg.allowed_roles)
    WHERE cg.membership_mode = 'role' AND cg.club_id IS NOT NULL AND cg.team_id IS NULL AND cg.mini_league_id IS NULL),
  via_team_role AS (
    SELECT cg.id FROM public.chat_groups cg
    JOIN public.user_roles ur ON ur.user_id = _user_id AND ur.team_id = cg.team_id AND ur.role = ANY (cg.allowed_roles)
    WHERE cg.membership_mode = 'role' AND cg.team_id IS NOT NULL),
  via_captain AS (
    SELECT cg.id FROM public.chat_groups cg
    JOIN public.team_captains tc ON tc.user_id = _user_id
    JOIN public.teams t ON t.id = tc.team_id AND t.deleted_at IS NULL
    WHERE cg.membership_mode = 'role' AND cg.include_captains = true AND cg.mini_league_id IS NULL
      AND ((cg.team_id IS NOT NULL AND tc.team_id = cg.team_id)
        OR (cg.team_id IS NULL AND cg.club_id IS NOT NULL AND t.club_id = cg.club_id))),
  via_league_club_role AS (
    SELECT cg.id FROM public.chat_groups cg
    JOIN public.mini_leagues ml ON ml.id = cg.mini_league_id
    JOIN public.user_roles ur ON ur.user_id = _user_id AND ur.club_id = ml.club_id
     AND ur.role IN ('league_admin'::app_role,'club_admin'::app_role,'app_admin'::app_role)
    WHERE cg.membership_mode = 'role' AND cg.mini_league_id IS NOT NULL),
  via_league_admin AS (
    SELECT cg.id FROM public.chat_groups cg
    JOIN public.mini_league_admins mla ON mla.mini_league_id = cg.mini_league_id AND mla.user_id = _user_id
    WHERE cg.membership_mode = 'role' AND cg.mini_league_id IS NOT NULL),
  via_league_player_parent AS (
    SELECT cg.id FROM public.chat_groups cg
    JOIN public.mini_league_players mlp ON mlp.mini_league_id = cg.mini_league_id AND mlp.parent_user_id = _user_id
    WHERE cg.membership_mode = 'role' AND cg.mini_league_id IS NOT NULL)
  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::uuid[])
  FROM (
    SELECT id FROM via_membership
    UNION SELECT id FROM via_club_admin
    UNION SELECT id FROM via_app_admin_manual
    UNION SELECT id FROM via_club_role
    UNION SELECT id FROM via_team_role
    UNION SELECT id FROM via_captain
    UNION SELECT id FROM via_league_club_role
    UNION SELECT id FROM via_league_admin
    UNION SELECT id FROM via_league_player_parent
  ) s;
$function$;