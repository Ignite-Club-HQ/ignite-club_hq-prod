-- Delete Snake test user and reset invite
DELETE FROM auth.users WHERE id = '22303865-db63-4d50-8412-02d063e6d34d';

-- Reset the pending invite for retesting
UPDATE pending_invites 
SET status = 'pending', accepted_at = NULL, invited_user_id = NULL 
WHERE invited_email = 'icpchainapps@gmail.com';