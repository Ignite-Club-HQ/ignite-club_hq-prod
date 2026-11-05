
CREATE OR REPLACE FUNCTION generate_invite_short_code()
RETURNS TRIGGER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  result TEXT := '';
  i INTEGER;
  attempts INTEGER := 0;
BEGIN
  IF NEW.short_code IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  LOOP
    result := '';
    FOR i IN 1..7 LOOP
      result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    
    IF NOT EXISTS (SELECT 1 FROM public.pending_invites WHERE short_code = result) THEN
      NEW.short_code := result;
      EXIT;
    END IF;
    
    attempts := attempts + 1;
    IF attempts > 10 THEN
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
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
