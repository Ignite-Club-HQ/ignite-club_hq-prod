-- Delete user "Icey" (id: 5d8670c6-5dff-4e85-9919-a011d33ca8ea)
DELETE FROM public.user_roles WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.notifications WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.push_subscriptions WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.notification_preferences WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.rsvps WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.chat_mute_preferences WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.message_reads WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.message_reactions WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.photo_reactions WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.photo_comment_reactions WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.photo_comments WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.feedback WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.pending_invites WHERE invited_user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.pending_invites WHERE invited_by_user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.role_requests WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.favorite_event_titles WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.favorite_opponents WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.active_games WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.game_summaries WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.game_player_stats WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.player_of_match WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.event_payments WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.member_subscription_payments WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.reward_redemptions WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.pitch_formations WHERE user_id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
UPDATE public.duties SET assigned_to = NULL WHERE assigned_to = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM public.profiles WHERE id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';
DELETE FROM auth.users WHERE id = '5d8670c6-5dff-4e85-9919-a011d33ca8ea';

-- Also reset the pending invite to pending so it can be used again for testing
UPDATE public.pending_invites 
SET status = 'pending', accepted_at = NULL, invited_user_id = NULL 
WHERE invited_email = 'icpchainapps@gmail.com';