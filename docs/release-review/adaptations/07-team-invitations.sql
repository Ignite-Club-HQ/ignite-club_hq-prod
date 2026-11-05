-- REVIEW / LOCAL REHEARSAL ONLY. Retain legacy accepted-only eligibility.
-- Generated package first supplies legacy body with authenticated caller binding.
-- New one-argument API delegates; do not add redundant permissive invite policies.
CREATE FUNCTION public.can_invite_players_to_team(_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.can_invite_players_to_team(auth.uid(),_team_id)
$$;
REVOKE ALL ON FUNCTION public.can_invite_players_to_team(uuid),public.can_invite_players_to_team(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_invite_players_to_team(uuid),public.can_invite_players_to_team(uuid,uuid) TO authenticated,service_role;