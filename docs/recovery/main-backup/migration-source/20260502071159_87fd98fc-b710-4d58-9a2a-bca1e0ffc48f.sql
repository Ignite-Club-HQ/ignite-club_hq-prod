REVOKE EXECUTE ON FUNCTION public.get_club_leaderboard(uuid, text, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_club_leaderboard(uuid, text, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_team_leaderboard(uuid, text, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_team_leaderboard(uuid, text, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_leaderboard_teams(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_leaderboard_teams(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.get_club_leaderboard(uuid, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(uuid, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_leaderboard_teams(uuid) TO authenticated;