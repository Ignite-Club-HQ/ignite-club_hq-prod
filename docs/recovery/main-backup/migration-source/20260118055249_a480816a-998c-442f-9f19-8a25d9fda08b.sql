-- Add email delivery tracking columns to pending_invites
ALTER TABLE public.pending_invites 
ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS email_id TEXT,
ADD COLUMN IF NOT EXISTS email_error TEXT;

-- Add index for filtering by email status
CREATE INDEX IF NOT EXISTS idx_pending_invites_email_sent ON public.pending_invites(email_sent_at) WHERE email_sent_at IS NOT NULL;

COMMENT ON COLUMN public.pending_invites.email_sent_at IS 'Timestamp when invite email was successfully sent';
COMMENT ON COLUMN public.pending_invites.email_id IS 'Email provider ID for tracking delivery';
COMMENT ON COLUMN public.pending_invites.email_error IS 'Error message if email failed to send';