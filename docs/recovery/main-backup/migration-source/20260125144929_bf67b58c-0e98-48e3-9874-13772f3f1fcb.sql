-- Create a security definer function to check if a user's email matches the invite
CREATE OR REPLACE FUNCTION public.user_email_matches_invite(_user_id uuid, _invited_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users au
    WHERE au.id = _user_id
      AND lower(au.email) = lower(_invited_email)
  )
$$;

-- Drop the problematic SELECT policy that references auth.users directly
DROP POLICY IF EXISTS "Users can view their own pending invites" ON public.pending_invites;

-- Recreate with security definer function
CREATE POLICY "Users can view their own pending invites"
ON public.pending_invites
FOR SELECT
USING (
  invited_user_id = auth.uid()
  OR (
    invited_email IS NOT NULL 
    AND public.user_email_matches_invite(auth.uid(), invited_email)
  )
);

-- Also fix the UPDATE policy that has the same issue
DROP POLICY IF EXISTS "Users can accept their own pending invites" ON public.pending_invites;

CREATE POLICY "Users can accept their own pending invites"
ON public.pending_invites
FOR UPDATE
USING (
  invited_user_id = auth.uid()
  OR (
    invited_email IS NOT NULL 
    AND public.user_email_matches_invite(auth.uid(), invited_email)
  )
)
WITH CHECK (
  status = 'accepted' AND accepted_at IS NOT NULL
);