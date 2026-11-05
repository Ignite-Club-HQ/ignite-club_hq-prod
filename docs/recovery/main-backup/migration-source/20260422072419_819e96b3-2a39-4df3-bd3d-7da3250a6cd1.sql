CREATE OR REPLACE FUNCTION public.mask_email(_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _email IS NULL OR position('@' in _email) < 2 THEN NULL
    WHEN length(split_part(_email, '@', 1)) <= 2
      THEN left(split_part(_email, '@', 1), 1) || '***@' || split_part(_email, '@', 2)
    ELSE
      left(split_part(_email, '@', 1), 2) || '***@' || split_part(_email, '@', 2)
  END
$$;