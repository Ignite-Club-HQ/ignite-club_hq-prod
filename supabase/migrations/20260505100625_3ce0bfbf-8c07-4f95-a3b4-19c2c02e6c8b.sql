
REVOKE EXECUTE ON FUNCTION public.increment_user_club_points(uuid, uuid, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.increment_child_club_points(uuid, uuid, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_user_club_points(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_child_club_points(uuid, uuid) FROM anon, public;
