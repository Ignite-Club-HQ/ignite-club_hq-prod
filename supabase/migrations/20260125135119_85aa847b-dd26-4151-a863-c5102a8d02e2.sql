-- Fix existing pending invites where invited_user_id incorrectly equals invited_by_user_id
UPDATE public.pending_invites 
SET invited_user_id = NULL 
WHERE invited_user_id = invited_by_user_id 
  AND status = 'pending';