-- First: add columns (must exist before function references them)
ALTER TABLE public.seasons 
ADD COLUMN IF NOT EXISTS eoi_embed_code TEXT,
ADD COLUMN IF NOT EXISTS eoi_webhook_token TEXT;

-- Create unique index for webhook token lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_webhook_token 
ON public.seasons(eoi_webhook_token) 
WHERE eoi_webhook_token IS NOT NULL;

-- Now create the function that references the columns
CREATE OR REPLACE FUNCTION public.validate_eoi_webhook_token(_club_id UUID, _token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.seasons
    WHERE club_id = _club_id
      AND eoi_enabled = true
      AND eoi_webhook_token = _token
  );
$$;