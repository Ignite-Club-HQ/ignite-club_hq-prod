-- Add logo_url column to mini_leagues table
ALTER TABLE public.mini_leagues ADD COLUMN logo_url text;

-- Add comment for documentation
COMMENT ON COLUMN public.mini_leagues.logo_url IS 'URL to the mini league profile image stored in club-logos bucket';