-- Delete user "Post" (id: 5e680b82-d4dc-4f70-97e0-77198ee495a0)

-- Delete from related tables first
DELETE FROM user_roles WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM push_subscriptions WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM notification_preferences WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM notifications WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM rsvps WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM duties WHERE assigned_to = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM message_reads WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM message_reactions WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM chat_mute_preferences WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM group_members WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM feedback WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM favorite_event_titles WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM favorite_opponents WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM event_payments WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM member_subscription_payments WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM reward_redemptions WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM active_games WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM game_player_stats WHERE user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';

-- Reset pending invites if this user accepted any
UPDATE pending_invites 
SET invited_user_id = NULL, accepted_at = NULL, status = 'pending'
WHERE invited_user_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';

-- Delete direct messages and conversations
DELETE FROM direct_messages WHERE author_id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';
DELETE FROM direct_conversations WHERE participant_1 = '5e680b82-d4dc-4f70-97e0-77198ee495a0' OR participant_2 = '5e680b82-d4dc-4f70-97e0-77198ee495a0';

-- Delete the profile
DELETE FROM profiles WHERE id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';

-- Delete from auth.users
DELETE FROM auth.users WHERE id = '5e680b82-d4dc-4f70-97e0-77198ee495a0';