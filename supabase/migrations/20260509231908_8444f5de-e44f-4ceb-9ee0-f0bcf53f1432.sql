REVOKE EXECUTE ON FUNCTION public.get_event_non_responders(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_non_responders(uuid) TO service_role;