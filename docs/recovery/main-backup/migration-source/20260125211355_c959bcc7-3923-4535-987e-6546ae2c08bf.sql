-- Delete user 'Car' from auth.users (will cascade to profiles)
DELETE FROM auth.users WHERE id = 'ffb00332-5f1a-4f51-91bc-481f87572c65';

-- Also clean up any pending invites for this user
UPDATE pending_invites 
SET invited_user_id = NULL, accepted_at = NULL, status = 'pending'
WHERE invited_user_id = 'ffb00332-5f1a-4f51-91bc-481f87572c65';