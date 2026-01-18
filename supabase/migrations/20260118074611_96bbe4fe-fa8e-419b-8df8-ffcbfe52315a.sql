-- Add created_by column to promo_codes table
ALTER TABLE public.promo_codes 
ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add index for created_by for faster lookups
CREATE INDEX IF NOT EXISTS idx_promo_codes_created_by ON public.promo_codes(created_by);