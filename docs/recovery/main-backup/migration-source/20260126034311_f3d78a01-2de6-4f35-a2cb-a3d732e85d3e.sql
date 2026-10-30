-- Delete user Chook (e4bd9e0e-3040-4923-9820-8db704ef05da) and dependencies
DELETE FROM public.pending_invites WHERE invited_user_id = 'e4bd9e0e-3040-4923-9820-8db704ef05da' OR invited_by_user_id = 'e4bd9e0e-3040-4923-9820-8db704ef05da';
DELETE FROM public.profiles WHERE id = 'e4bd9e0e-3040-4923-9820-8db704ef05da';
DELETE FROM auth.users WHERE id = 'e4bd9e0e-3040-4923-9820-8db704ef05da';