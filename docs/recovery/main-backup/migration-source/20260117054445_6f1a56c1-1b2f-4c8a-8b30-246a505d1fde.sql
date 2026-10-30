-- Add a unique token to pending_invites for name-restricted invite links
ALTER TABLE public.pending_invites 
ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE;

-- Create index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_pending_invites_token ON public.pending_invites(invite_token);

-- Add RLS policy to allow reading pending invites by token (for join flow)
CREATE POLICY "Anyone can read pending invites by token" 
ON public.pending_invites 
FOR SELECT 
USING (invite_token IS NOT NULL);