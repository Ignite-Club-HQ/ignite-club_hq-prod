-- Add sponsor tier enum
CREATE TYPE public.sponsor_tier AS ENUM ('platinum', 'gold', 'silver', 'bronze');

-- Add tier and exposure percentage to sponsors
ALTER TABLE public.sponsors 
  ADD COLUMN tier public.sponsor_tier DEFAULT NULL,
  ADD COLUMN exposure_percentage INTEGER DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.sponsors.tier IS 'Sponsor tier: platinum (4x), gold (3x), silver (2x), bronze (1x). NULL = no tier.';
COMMENT ON COLUMN public.sponsors.exposure_percentage IS 'Custom exposure percentage override (0-100). If set, overrides tier weighting.';