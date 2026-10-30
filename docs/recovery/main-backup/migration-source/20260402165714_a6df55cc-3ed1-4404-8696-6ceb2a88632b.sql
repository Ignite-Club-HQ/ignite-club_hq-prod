
-- Add short_code column for short invite URLs
ALTER TABLE public.pending_invites 
ADD COLUMN IF NOT EXISTS short_code TEXT UNIQUE;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pending_invites_short_code ON public.pending_invites(short_code) WHERE short_code IS NOT NULL;

-- Function to generate a random 7-char alphanumeric code
CREATE OR REPLACE FUNCTION generate_invite_short_code()
RETURNS TRIGGER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  result TEXT := '';
  i INTEGER;
  attempts INTEGER := 0;
BEGIN
  -- Only generate if not already set
  IF NEW.short_code IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  LOOP
    result := '';
    FOR i IN 1..7 LOOP
      result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    
    -- Check uniqueness
    IF NOT EXISTS (SELECT 1 FROM public.pending_invites WHERE short_code = result) THEN
      NEW.short_code := result;
      EXIT;
    END IF;
    
    attempts := attempts + 1;
    IF attempts > 10 THEN
      -- Fallback: use longer code
      result := '';
      FOR i IN 1..10 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;
      NEW.short_code := result;
      EXIT;
    END IF;
  END LOOP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate short_code on insert
DROP TRIGGER IF EXISTS trigger_generate_invite_short_code ON public.pending_invites;
CREATE TRIGGER trigger_generate_invite_short_code
  BEFORE INSERT ON public.pending_invites
  FOR EACH ROW
  EXECUTE FUNCTION generate_invite_short_code();

-- Backfill existing invites that don't have a short_code
DO $$
DECLARE
  r RECORD;
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  code TEXT;
  i INTEGER;
BEGIN
  FOR r IN SELECT id FROM public.pending_invites WHERE short_code IS NULL AND status = 'pending' LOOP
    LOOP
      code := '';
      FOR i IN 1..7 LOOP
        code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;
      BEGIN
        UPDATE public.pending_invites SET short_code = code WHERE id = r.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- Try again
      END;
    END LOOP;
  END LOOP;
END $$;
