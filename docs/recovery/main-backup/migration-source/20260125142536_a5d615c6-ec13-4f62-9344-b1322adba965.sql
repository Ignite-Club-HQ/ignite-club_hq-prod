
-- Delete user "Pooy" (id: b3385ee2-921e-4e45-a2a8-1db8e33a7b8c)
DELETE FROM public.user_roles WHERE user_id = 'b3385ee2-921e-4e45-a2a8-1db8e33a7b8c';
DELETE FROM public.notifications WHERE user_id = 'b3385ee2-921e-4e45-a2a8-1db8e33a7b8c';
DELETE FROM public.push_subscriptions WHERE user_id = 'b3385ee2-921e-4e45-a2a8-1db8e33a7b8c';
DELETE FROM public.notification_preferences WHERE user_id = 'b3385ee2-921e-4e45-a2a8-1db8e33a7b8c';
DELETE FROM public.message_reads WHERE user_id = 'b3385ee2-921e-4e45-a2a8-1db8e33a7b8c';
DELETE FROM public.profiles WHERE id = 'b3385ee2-921e-4e45-a2a8-1db8e33a7b8c';
DELETE FROM auth.users WHERE id = 'b3385ee2-921e-4e45-a2a8-1db8e33a7b8c';

-- Reset the pending invite for re-testing
UPDATE public.pending_invites 
SET status = 'pending', accepted_at = NULL, invited_user_id = NULL 
WHERE invited_email = 'icpchainapps@gmail.com';
