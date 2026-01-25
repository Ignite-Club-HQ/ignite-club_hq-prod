-- Delete user 800b2b1d-a5c5-441d-9c02-2b0affebb45b (icpchainapps@gmail.com / Ferty)
DELETE FROM public.user_roles WHERE user_id = '800b2b1d-a5c5-441d-9c02-2b0affebb45b';
DELETE FROM public.notifications WHERE user_id = '800b2b1d-a5c5-441d-9c02-2b0affebb45b';
DELETE FROM public.push_subscriptions WHERE user_id = '800b2b1d-a5c5-441d-9c02-2b0affebb45b';
DELETE FROM public.notification_preferences WHERE user_id = '800b2b1d-a5c5-441d-9c02-2b0affebb45b';
DELETE FROM public.message_reads WHERE user_id = '800b2b1d-a5c5-441d-9c02-2b0affebb45b';
DELETE FROM public.profiles WHERE id = '800b2b1d-a5c5-441d-9c02-2b0affebb45b';
DELETE FROM auth.users WHERE id = '800b2b1d-a5c5-441d-9c02-2b0affebb45b';

-- Reset invite for re-testing
UPDATE public.pending_invites 
SET status = 'pending', accepted_at = NULL, invited_user_id = NULL 
WHERE invited_email = 'icpchainapps@gmail.com';