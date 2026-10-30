-- Add term_status column for archiving support
ALTER TABLE public.terms ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived'));

-- Migrate existing is_active data
UPDATE public.terms SET status = CASE WHEN is_active = true THEN 'active' ELSE 'archived' END;