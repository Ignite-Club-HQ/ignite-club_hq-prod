-- Delete user Chook (166c6eef-7a71-4b6f-a2ec-493a1a5d7615) and related records
DELETE FROM public.pending_invites WHERE invited_user_id = '166c6eef-7a71-4b6f-a2ec-493a1a5d7615';
DELETE FROM public.profiles WHERE id = '166c6eef-7a71-4b6f-a2ec-493a1a5d7615';
DELETE FROM auth.users WHERE id = '166c6eef-7a71-4b6f-a2ec-493a1a5d7615';