-- Delete pending invite for user Chook
DELETE FROM public.pending_invites WHERE invited_user_id = 'e5c50249-0beb-44fd-ab38-9a6951563e6a';

-- Delete profile
DELETE FROM public.profiles WHERE id = 'e5c50249-0beb-44fd-ab38-9a6951563e6a';

-- Delete auth user
DELETE FROM auth.users WHERE id = 'e5c50249-0beb-44fd-ab38-9a6951563e6a';