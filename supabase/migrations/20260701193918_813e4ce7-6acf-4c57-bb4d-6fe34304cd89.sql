-- Lock down SECURITY DEFINER functions created in the denormalization migration
-- so they are not callable anonymously (only triggers or authenticated/service roles should use them).

REVOKE ALL ON FUNCTION public.bump_chat_group_unread_on_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_chat_group_unread_on_read()   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_chat_group_unread()       FROM PUBLIC;

-- reconcile canary is useful for authenticated admins and service_role jobs
GRANT EXECUTE ON FUNCTION public.reconcile_chat_group_unread() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_chat_group_unread() TO service_role;