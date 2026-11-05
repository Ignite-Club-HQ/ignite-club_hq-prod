-- Add theme_enabled column to clubs table
ALTER TABLE public.clubs 
ADD COLUMN theme_enabled boolean NOT NULL DEFAULT true;

-- Add comment for clarity
COMMENT ON COLUMN public.clubs.theme_enabled IS 'Master toggle to enable/disable club theme for members';