-- Delete user Chook (0b12624a-d614-4216-b0b1-e0b11e6f58b3) and dependencies
DELETE FROM public.pending_invites WHERE invited_user_id = '0b12624a-d614-4216-b0b1-e0b11e6f58b3';
DELETE FROM public.profiles WHERE id = '0b12624a-d614-4216-b0b1-e0b11e6f58b3';
DELETE FROM auth.users WHERE id = '0b12624a-d614-4216-b0b1-e0b11e6f58b3';