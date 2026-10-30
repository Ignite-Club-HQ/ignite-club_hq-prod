
-- Delete the profile first (this will cascade or we delete manually)
DELETE FROM public.profiles WHERE id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';

-- Delete the auth user
DELETE FROM auth.users WHERE id = 'cdbb78a9-c67c-4193-a75a-d6b6fbf6766d';
