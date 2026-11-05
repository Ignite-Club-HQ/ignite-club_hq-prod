REVOKE ALL ON FUNCTION public.is_competition_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_competition_admin_conversation(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.on_competition_admin_message_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_competition_admin_reply() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_competition_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_competition_admin_conversation(uuid, uuid) TO authenticated;