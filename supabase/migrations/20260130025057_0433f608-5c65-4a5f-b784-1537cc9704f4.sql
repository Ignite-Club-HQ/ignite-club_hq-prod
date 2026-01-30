-- Add columns to track reminder emails for pending invites
ALTER TABLE public.pending_invites 
ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0;

-- Add index for efficient reminder queries
CREATE INDEX IF NOT EXISTS idx_pending_invites_reminder 
ON public.pending_invites (status, last_reminder_sent_at) 
WHERE status = 'pending';