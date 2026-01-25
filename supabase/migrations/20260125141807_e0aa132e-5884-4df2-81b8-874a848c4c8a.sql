
-- Allow users to read their own pending invites (by email or user_id)
-- This is needed so the CompleteProfilePage can find and process pending invites
CREATE POLICY "Users can view their own pending invites"
ON public.pending_invites
FOR SELECT
USING (
  invited_user_id = auth.uid()
  OR (
    invited_email IS NOT NULL 
    AND EXISTS (
      SELECT 1 FROM auth.users au 
      WHERE au.id = auth.uid() 
      AND LOWER(au.email) = LOWER(pending_invites.invited_email)
    )
  )
);

-- Allow users to update their own pending invites to accepted status
-- This is needed so the CompleteProfilePage can mark invites as accepted
CREATE POLICY "Users can accept their own pending invites"
ON public.pending_invites
FOR UPDATE
USING (
  invited_user_id = auth.uid()
  OR (
    invited_email IS NOT NULL 
    AND EXISTS (
      SELECT 1 FROM auth.users au 
      WHERE au.id = auth.uid() 
      AND LOWER(au.email) = LOWER(pending_invites.invited_email)
    )
  )
)
WITH CHECK (
  status = 'accepted'
  AND accepted_at IS NOT NULL
);
