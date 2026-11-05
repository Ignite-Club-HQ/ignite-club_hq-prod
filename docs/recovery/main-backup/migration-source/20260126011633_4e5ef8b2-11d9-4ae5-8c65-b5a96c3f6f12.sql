-- Delete user 'Zelp' (ID: cdbb78a9-c67c-4193-a75a-d6b6fbf6766d) and all associated records

-- Delete pending invites
DELETE FROM public.pending_invites WHERE invited_user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d' OR invited_by_user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete notifications
DELETE FROM public.notifications WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete RSVPs
DELETE FROM public.rsvps WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete group members
DELETE FROM public.group_members WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete message reactions
DELETE FROM public.message_reactions WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete message reads
DELETE FROM public.message_reads WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete chat mute preferences
DELETE FROM public.chat_mute_preferences WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete direct messages first
DELETE FROM public.direct_messages WHERE author_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';
DELETE FROM public.direct_messages WHERE conversation_id IN (
  SELECT id FROM public.direct_conversations 
  WHERE participant_1 = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d' 
     OR participant_2 = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d'
);

-- Delete hidden DM conversations
DELETE FROM public.hidden_dm_conversations WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';
DELETE FROM public.hidden_dm_conversations WHERE conversation_id IN (
  SELECT id FROM public.direct_conversations 
  WHERE participant_1 = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d' 
     OR participant_2 = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d'
);

-- Delete direct conversations
DELETE FROM public.direct_conversations WHERE participant_1 = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d' OR participant_2 = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete push subscriptions
DELETE FROM public.push_subscriptions WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete notification preferences
DELETE FROM public.notification_preferences WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete user roles
DELETE FROM public.user_roles WHERE user_id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete profile
DELETE FROM public.profiles WHERE id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';