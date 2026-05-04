REVOKE EXECUTE ON FUNCTION public.is_team_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_team_member(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_team_member(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_club_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_club_member(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_club_member(uuid, uuid) TO authenticated;