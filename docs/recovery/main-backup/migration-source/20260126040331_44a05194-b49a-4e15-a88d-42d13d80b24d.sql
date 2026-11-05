-- Delete user Dino (7172e75c-e059-4a10-ae30-e00f6c77424a) and all associated records

-- Delete from pending_invites
DELETE FROM public.pending_invites WHERE invited_user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a' OR invited_by_user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from user_roles
DELETE FROM public.user_roles WHERE user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from notifications
DELETE FROM public.notifications WHERE user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from push_subscriptions
DELETE FROM public.push_subscriptions WHERE user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from notification_preferences
DELETE FROM public.notification_preferences WHERE user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from rsvps
DELETE FROM public.rsvps WHERE user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from chat_mute_preferences
DELETE FROM public.chat_mute_preferences WHERE user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from message_reads
DELETE FROM public.message_reads WHERE user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from message_reactions
DELETE FROM public.message_reactions WHERE user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from group_members
DELETE FROM public.group_members WHERE user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from feedback
DELETE FROM public.feedback WHERE user_id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from profile
DELETE FROM public.profiles WHERE id = '7172e75c-e059-4a10-ae30-e00f6c77424a';

-- Delete from auth.users
DELETE FROM auth.users WHERE id = '7172e75c-e059-4a10-ae30-e00f6c77424a';