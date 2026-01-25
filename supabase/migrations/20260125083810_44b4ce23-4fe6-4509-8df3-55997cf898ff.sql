-- Create function to generate SHA-256 hash of email for Gravatar
CREATE OR REPLACE FUNCTION public.generate_email_hash(email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(digest(lower(trim(email)), 'sha256'), 'hex')
$$;

-- Update existing profiles with email_hash from auth.users
UPDATE public.profiles p
SET email_hash = public.generate_email_hash(u.email)
FROM auth.users u
WHERE p.id = u.id
  AND p.email_hash IS NULL
  AND u.email IS NOT NULL;

-- Create trigger function to auto-set email_hash when profile is created
CREATE OR REPLACE FUNCTION public.set_profile_email_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_email text;
BEGIN
  -- Get email from auth.users
  SELECT email INTO user_email FROM auth.users WHERE id = NEW.id;
  
  IF user_email IS NOT NULL THEN
    NEW.email_hash := public.generate_email_hash(user_email);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on profile insert
DROP TRIGGER IF EXISTS set_email_hash_on_insert ON public.profiles;
CREATE TRIGGER set_email_hash_on_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_profile_email_hash();