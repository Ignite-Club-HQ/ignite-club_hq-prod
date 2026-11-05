-- Delete user 'Chook' (40e19191-d84a-4f7c-b3f0-d6e16372708f) and related records

-- Delete pending invites
DELETE FROM public.pending_invites WHERE invited_user_id = '40e19191-d84a-4f7c-b3f0-d6e16372708f';

-- Delete profile
DELETE FROM public.profiles WHERE id = '40e19191-d84a-4f7c-b3f0-d6e16372708f';

-- Delete auth user
DELETE FROM auth.users WHERE id = '40e19191-d84a-4f7c-b3f0-d6e16372708f';