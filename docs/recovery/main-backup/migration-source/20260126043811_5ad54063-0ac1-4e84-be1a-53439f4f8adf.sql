-- Delete user Hola (ID: 8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c)

-- Clean up pending invites
DELETE FROM public.pending_invites WHERE invited_user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c' OR invited_by_user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Clean up user roles
DELETE FROM public.user_roles WHERE user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Clean up notifications
DELETE FROM public.notifications WHERE user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Clean up push subscriptions
DELETE FROM public.push_subscriptions WHERE user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Clean up notification preferences
DELETE FROM public.notification_preferences WHERE user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Clean up RSVPs
DELETE FROM public.rsvps WHERE user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Clean up chat mute preferences
DELETE FROM public.chat_mute_preferences WHERE user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Clean up message reads
DELETE FROM public.message_reads WHERE user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Clean up message reactions
DELETE FROM public.message_reactions WHERE user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Clean up group members
DELETE FROM public.group_members WHERE user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Clean up feedback
DELETE FROM public.feedback WHERE user_id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Delete from profiles
DELETE FROM public.profiles WHERE id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';

-- Delete from auth.users
DELETE FROM auth.users WHERE id = '8e0d7ad7-d75f-40ac-b1cd-66e5a0c2a91c';