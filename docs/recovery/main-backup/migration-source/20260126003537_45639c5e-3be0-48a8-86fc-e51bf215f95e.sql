-- Delete user 'Donkeycat' (id: cdbb78a9-c67c-4193-a75a-d6b6fbf6766d)

-- Delete from pending_invites (as invited user)
DELETE FROM public.pending_invites WHERE invited_user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete notifications
DELETE FROM public.notifications WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete RSVPs
DELETE FROM public.rsvps WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete group memberships
DELETE FROM public.group_members WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete message reactions
DELETE FROM public.message_reactions WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete message reads
DELETE FROM public.message_reads WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete chat mute preferences
DELETE FROM public.chat_mute_preferences WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete direct messages authored by this user
DELETE FROM public.direct_messages WHERE author_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete direct conversations involving this user
DELETE FROM public.direct_conversations WHERE participant_1 = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d' OR participant_2 = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete user roles
DELETE FROM public.user_roles WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete profile
DELETE FROM public.profiles WHERE id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';