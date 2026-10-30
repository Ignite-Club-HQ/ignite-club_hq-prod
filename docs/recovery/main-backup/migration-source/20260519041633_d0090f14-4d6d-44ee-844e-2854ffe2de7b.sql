GRANT EXECUTE ON FUNCTION public.is_club_member(uuid, uuid) TO anon, authenticated, service_role, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_team_member(uuid, uuid) TO anon, authenticated, service_role, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_association_admin(uuid, uuid) TO anon, authenticated, service_role, PUBLIC;