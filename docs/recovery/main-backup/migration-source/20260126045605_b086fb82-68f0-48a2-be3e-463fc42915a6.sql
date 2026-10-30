-- Delete user Spark (9a43c839-a73c-4f06-a5c7-740566d1aefc)
DELETE FROM public.pending_invites WHERE invited_user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc' OR invited_by_user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM public.user_roles WHERE user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM public.notifications WHERE user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM public.push_subscriptions WHERE user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM public.notification_preferences WHERE user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM public.rsvps WHERE user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM public.chat_mute_preferences WHERE user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM public.message_reads WHERE user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM public.message_reactions WHERE user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM public.group_members WHERE user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM public.feedback WHERE user_id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM public.profiles WHERE id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';
DELETE FROM auth.users WHERE id = '9a43c839-a73c-4f06-a5c7-740566d1aefc';