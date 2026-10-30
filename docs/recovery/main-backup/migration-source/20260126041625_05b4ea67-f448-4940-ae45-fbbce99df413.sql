-- Delete user Kitty (5dcdd75b-83c0-4871-8d06-2145f009d7f6) and all associated records

-- Delete from pending_invites
DELETE FROM public.pending_invites WHERE invited_user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6' OR invited_by_user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from user_roles
DELETE FROM public.user_roles WHERE user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from notifications
DELETE FROM public.notifications WHERE user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from push_subscriptions
DELETE FROM public.push_subscriptions WHERE user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from notification_preferences
DELETE FROM public.notification_preferences WHERE user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from rsvps
DELETE FROM public.rsvps WHERE user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from chat_mute_preferences
DELETE FROM public.chat_mute_preferences WHERE user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from message_reads
DELETE FROM public.message_reads WHERE user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from message_reactions
DELETE FROM public.message_reactions WHERE user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from group_members
DELETE FROM public.group_members WHERE user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from feedback
DELETE FROM public.feedback WHERE user_id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from profile
DELETE FROM public.profiles WHERE id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';

-- Delete from auth.users
DELETE FROM auth.users WHERE id = '5dcdd75b-83c0-4871-8d06-2145f009d7f6';