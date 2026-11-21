CREATE OR REPLACE FUNCTION public.get_email_signup_invite_refusal(_token text, _email text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE inv record; allowed jsonb; club uuid;
BEGIN
  SELECT value->'emailAuthClubs' INTO allowed FROM public.app_settings WHERE key='backend_routing_config';
  IF allowed IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(allowed) IS DISTINCT FROM 'array' THEN RETURN 'invite_club_not_email_enabled'; END IF;
  IF jsonb_array_length(allowed)=0 THEN RETURN NULL; END IF;
  IF NULLIF(btrim(_token), '') IS NULL THEN RETURN 'invite_required'; END IF;
  SELECT * INTO inv FROM public.get_pending_invite_by_token(_token);
  IF FOUND THEN
    IF inv.status='expired' THEN RETURN 'invite_expired'; END IF;
    IF inv.status <> 'pending' THEN RETURN 'invite_used'; END IF;
    IF NULLIF(btrim(inv.invited_email),'') IS NOT NULL
       AND lower(btrim(inv.invited_email)) IS DISTINCT FROM lower(btrim(_email)) THEN RETURN 'invite_email_mismatch'; END IF;
    club := inv.club_id;
  ELSE
    SELECT * INTO inv FROM public.get_team_invite_by_token(_token);
    IF NOT FOUND THEN SELECT * INTO inv FROM public.get_club_invite_by_token(_token); END IF;
    IF NOT FOUND THEN RETURN 'invite_not_found'; END IF;
    IF inv.expires_at IS NOT NULL AND inv.expires_at <= now() THEN RETURN 'invite_expired'; END IF;
    IF inv.max_uses IS NOT NULL AND (inv.uses_count IS NULL OR inv.uses_count >= inv.max_uses) THEN RETURN 'invite_used'; END IF;
    club := inv.club_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a WHERE lower(a->>'id')=club::text) THEN RETURN 'invite_club_not_email_enabled'; END IF;
  RETURN NULL;
END;
$$;