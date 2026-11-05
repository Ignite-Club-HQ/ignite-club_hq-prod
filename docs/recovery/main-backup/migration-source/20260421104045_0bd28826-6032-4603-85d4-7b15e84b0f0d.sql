CREATE OR REPLACE FUNCTION public.resolve_invite_short_code(_code text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT invite_token::text
  FROM public.pending_invites
  WHERE short_code = _code
    AND status = 'pending'
    AND accepted_at IS NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_invite_short_code(text) TO anon, authenticated;