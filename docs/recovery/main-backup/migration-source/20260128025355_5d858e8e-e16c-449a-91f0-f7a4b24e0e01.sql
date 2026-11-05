-- Add minutes_per_half column to mini_leagues for default game timer setting
ALTER TABLE public.mini_leagues ADD COLUMN IF NOT EXISTS minutes_per_half integer NOT NULL DEFAULT 10;

-- Add comment for documentation
COMMENT ON COLUMN public.mini_leagues.minutes_per_half IS 'Default minutes per half for matches in this mini league';