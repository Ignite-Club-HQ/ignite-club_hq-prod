REVOKE EXECUTE ON FUNCTION public.get_club_day_events(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_club_day_events(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_club_day_events(uuid, date) TO authenticated;