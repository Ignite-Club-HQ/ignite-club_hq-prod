REVOKE ALL ON FUNCTION public.guard_competition_contact_members() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_competition_role_sync_contact_chats() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_contact_competition_admins(uuid, uuid) FROM public, anon, authenticated;