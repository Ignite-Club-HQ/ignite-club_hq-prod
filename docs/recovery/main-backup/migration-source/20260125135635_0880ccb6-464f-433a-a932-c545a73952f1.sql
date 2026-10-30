-- Fix the pending invite that was created with wrong invited_user_id
-- This invite for icpchainapps@gmail.com incorrectly has the inviter's ID
UPDATE public.pending_invites
SET invited_user_id = NULL
WHERE invited_email IS NOT NULL
  AND invited_user_id IS NOT NULL
  AND status = 'pending'
  AND invited_user_id = invited_by_user_id;