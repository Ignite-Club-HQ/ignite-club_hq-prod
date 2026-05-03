REVOKE EXECUTE ON FUNCTION public.can_manage_team_join_token(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_team_join_token(UUID, UUID, UUID) TO authenticated;