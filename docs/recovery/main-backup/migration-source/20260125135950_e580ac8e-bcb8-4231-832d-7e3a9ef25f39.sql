-- Delete user "Icey" (id: 1f5c0bb9-fef1-4faf-8825-66059eb00f0b)

-- Delete user roles
DELETE FROM public.user_roles WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete notifications
DELETE FROM public.notifications WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete push subscriptions
DELETE FROM public.push_subscriptions WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete notification preferences
DELETE FROM public.notification_preferences WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete RSVPs
DELETE FROM public.rsvps WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete chat mute preferences
DELETE FROM public.chat_mute_preferences WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete message reads
DELETE FROM public.message_reads WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete message reactions
DELETE FROM public.message_reactions WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete photo reactions
DELETE FROM public.photo_reactions WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete photo comment reactions
DELETE FROM public.photo_comment_reactions WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete photo comments
DELETE FROM public.photo_comments WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete feedback
DELETE FROM public.feedback WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete pending invites
DELETE FROM public.pending_invites WHERE invited_user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';
DELETE FROM public.pending_invites WHERE invited_by_user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete role requests
DELETE FROM public.role_requests WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete favorite event titles
DELETE FROM public.favorite_event_titles WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete favorite opponents
DELETE FROM public.favorite_opponents WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete active games
DELETE FROM public.active_games WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete game summaries
DELETE FROM public.game_summaries WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete game player stats
DELETE FROM public.game_player_stats WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete player of match records
DELETE FROM public.player_of_match WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete event payments
DELETE FROM public.event_payments WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete member subscription payments
DELETE FROM public.member_subscription_payments WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete reward redemptions
DELETE FROM public.reward_redemptions WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete pitch formations
DELETE FROM public.pitch_formations WHERE user_id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Unassign duties
UPDATE public.duties SET assigned_to = NULL WHERE assigned_to = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete profile
DELETE FROM public.profiles WHERE id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';

-- Delete auth user
DELETE FROM auth.users WHERE id = '1f5c0bb9-fef1-4faf-8825-66059eb00f0b';