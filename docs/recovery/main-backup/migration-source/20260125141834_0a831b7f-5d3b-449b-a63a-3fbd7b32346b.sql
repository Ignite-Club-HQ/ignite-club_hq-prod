
-- Delete user "Pooy" to allow re-testing
DELETE FROM public.user_roles WHERE user_id = 'a5a4844b-a8e2-439a-b470-b4696da05347';
DELETE FROM public.notifications WHERE user_id = 'a5a4844b-a8e2-439a-b470-b4696da05347';
DELETE FROM public.push_subscriptions WHERE user_id = 'a5a4844b-a8e2-439a-b470-b4696da05347';
DELETE FROM public.notification_preferences WHERE user_id = 'a5a4844b-a8e2-439a-b470-b4696da05347';
DELETE FROM public.message_reads WHERE user_id = 'a5a4844b-a8e2-439a-b470-b4696da05347';
DELETE FROM public.profiles WHERE id = 'a5a4844b-a8e2-439a-b470-b4696da05347';
DELETE FROM auth.users WHERE id = 'a5a4844b-a8e2-439a-b470-b4696da05347';

-- Reset the pending invite
UPDATE public.pending_invites 
SET status = 'pending', accepted_at = NULL, invited_user_id = NULL 
WHERE invited_email = 'icpchainapps@gmail.com';
