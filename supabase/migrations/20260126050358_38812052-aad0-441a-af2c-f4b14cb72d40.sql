-- Delete user Egg (a3b4a200-b039-464c-ae35-98e9bc66f2b2)
DELETE FROM public.pending_invites WHERE invited_user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2' OR invited_by_user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM public.user_roles WHERE user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM public.notifications WHERE user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM public.push_subscriptions WHERE user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM public.notification_preferences WHERE user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM public.rsvps WHERE user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM public.chat_mute_preferences WHERE user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM public.message_reads WHERE user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM public.message_reactions WHERE user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM public.group_members WHERE user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM public.feedback WHERE user_id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM public.profiles WHERE id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';
DELETE FROM auth.users WHERE id = 'a3b4a200-b039-464c-ae35-98e9bc66f2b2';