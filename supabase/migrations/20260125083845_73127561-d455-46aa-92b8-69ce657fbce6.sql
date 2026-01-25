-- Fix function search path mutable warning for generate_email_hash
-- Need to include extensions schema for pgcrypto
CREATE OR REPLACE FUNCTION public.generate_email_hash(email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(lower(trim(email)), 'sha256'), 'hex')
$$;