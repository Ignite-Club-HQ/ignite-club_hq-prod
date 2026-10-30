-- Add invited_email column to pending_invites for sending notifications
ALTER TABLE public.pending_invites 
ADD COLUMN IF NOT EXISTS invited_email TEXT;

-- Add index for email lookups
CREATE INDEX IF NOT EXISTS idx_pending_invites_invited_email 
ON public.pending_invites(invited_email) 
WHERE invited_email IS NOT NULL;