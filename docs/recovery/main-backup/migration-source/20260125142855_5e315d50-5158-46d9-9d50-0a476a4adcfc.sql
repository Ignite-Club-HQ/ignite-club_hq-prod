
-- Delete user "Ferty" (id: fde84f5e-d141-44d4-9cc7-877b8beec697)
DELETE FROM public.user_roles WHERE user_id = 'fde84f5e-d141-44d4-9cc7-877b8beec697';
DELETE FROM public.notifications WHERE user_id = 'fde84f5e-d141-44d4-9cc7-877b8beec697';
DELETE FROM public.push_subscriptions WHERE user_id = 'fde84f5e-d141-44d4-9cc7-877b8beec697';
DELETE FROM public.notification_preferences WHERE user_id = 'fde84f5e-d141-44d4-9cc7-877b8beec697';
DELETE FROM public.message_reads WHERE user_id = 'fde84f5e-d141-44d4-9cc7-877b8beec697';
DELETE FROM public.profiles WHERE id = 'fde84f5e-d141-44d4-9cc7-877b8beec697';
DELETE FROM auth.users WHERE id = 'fde84f5e-d141-44d4-9cc7-877b8beec697';

-- Reset all pending invites for this email
UPDATE public.pending_invites 
SET status = 'pending', accepted_at = NULL, invited_user_id = NULL 
WHERE invited_email = 'icpchainapps@gmail.com';

-- Also delete duplicate invites, keep only the most recent one
DELETE FROM public.pending_invites 
WHERE invited_email = 'icpchainapps@gmail.com' 
AND id != (
  SELECT id FROM public.pending_invites 
  WHERE invited_email = 'icpchainapps@gmail.com' 
  ORDER BY created_at DESC 
  LIMIT 1
);
