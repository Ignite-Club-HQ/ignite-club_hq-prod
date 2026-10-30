DO $$
DECLARE
  uid UUID := '35785db5-dec3-43a2-b9d5-0da73336e45b';
BEGIN
  DELETE FROM public.user_roles WHERE user_id = uid;
  DELETE FROM public.notifications WHERE user_id = uid;
  DELETE FROM public.push_subscriptions WHERE user_id = uid;
  DELETE FROM public.notification_preferences WHERE user_id = uid;
  DELETE FROM public.rsvps WHERE user_id = uid;
  DELETE FROM public.message_reads WHERE user_id = uid;
  DELETE FROM public.message_reactions WHERE user_id = uid;
  DELETE FROM public.role_requests WHERE user_id = uid;
  DELETE FROM public.pending_invites WHERE invited_user_id = uid OR invited_by_user_id = uid;
  DELETE FROM public.profiles WHERE id = uid;
END $$;