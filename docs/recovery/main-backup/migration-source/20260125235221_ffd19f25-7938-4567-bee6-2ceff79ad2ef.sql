-- Delete user "Peanut" (id: 923e118e-3e75-4325-a3e4-8922704e3f17) and all associated invites

-- Delete pending invites where this user was invited
DELETE FROM pending_invites WHERE invited_user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';

-- Delete from related tables
DELETE FROM user_roles WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM push_subscriptions WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM notification_preferences WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM notifications WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM rsvps WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM duties WHERE assigned_to = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM message_reads WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM message_reactions WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM chat_mute_preferences WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM group_members WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM feedback WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM favorite_event_titles WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM favorite_opponents WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM event_payments WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM member_subscription_payments WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM reward_redemptions WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM active_games WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM game_player_stats WHERE user_id = '923e118e-3e75-4325-a3e4-8922704e3f17';

-- Delete direct messages and conversations
DELETE FROM direct_messages WHERE author_id = '923e118e-3e75-4325-a3e4-8922704e3f17';
DELETE FROM direct_conversations WHERE participant_1 = '923e118e-3e75-4325-a3e4-8922704e3f17' OR participant_2 = '923e118e-3e75-4325-a3e4-8922704e3f17';

-- Delete the profile
DELETE FROM profiles WHERE id = '923e118e-3e75-4325-a3e4-8922704e3f17';

-- Delete from auth.users
DELETE FROM auth.users WHERE id = '923e118e-3e75-4325-a3e4-8922704e3f17';