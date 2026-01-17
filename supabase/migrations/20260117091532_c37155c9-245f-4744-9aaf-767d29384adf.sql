-- Add metadata column to pending_invites for storing children data for parent invites
ALTER TABLE public.pending_invites 
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT NULL;

-- Add comment explaining the column purpose
COMMENT ON COLUMN public.pending_invites.metadata IS 'Stores additional invite data like children for parent role invites';