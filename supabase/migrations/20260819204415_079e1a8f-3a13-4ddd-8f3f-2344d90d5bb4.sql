CREATE OR REPLACE FUNCTION public.invite_token_has_existing_account(_token text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text;
  _exists boolean := false;
BEGIN
  IF _token IS NULL OR length(trim(_token)) = 0 THEN
    RETURN false;
  END IF;

  SELECT lower(trim(pi.invited_email))
    INTO _email
  FROM public.pending_invites pi
  WHERE pi.invite_token = _token
  LIMIT 1;

  IF _email IS NULL OR _email = '' THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM auth.users u WHERE lower(u.email) = _email
  ) INTO _exists;

  RETURN _exists;
END;
$$;

REVOKE ALL ON FUNCTION public.invite_token_has_existing_account(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_token_has_existing_account(text) TO anon, authenticated;