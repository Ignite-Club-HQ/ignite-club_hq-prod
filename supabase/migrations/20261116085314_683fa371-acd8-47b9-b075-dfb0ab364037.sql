DO $migration$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('public.email_signup_invite_allowed(text,text)'::regprocedure);
  IF position('AND lower(btrim(pi.invited_email)) = lower(btrim(_email))' in definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected signup helper definition';
  END IF;
  definition := replace(definition,
    'AND lower(btrim(pi.invited_email)) = lower(btrim(_email))',
    'AND (NULLIF(btrim(pi.invited_email), '''') IS NULL OR lower(btrim(pi.invited_email)) = lower(btrim(_email)))');
  EXECUTE definition;

  definition := pg_get_functiondef('public.accept_parent_team_invite(uuid,text)'::regprocedure);
  IF position('IF NOT (' in definition) = 0 OR position('AND _invite.invited_email IS NOT NULL' in definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected parent acceptance definition';
  END IF;
  definition := replace(definition,
    'IF _invite.invited_user_id = _uid THEN',
    'IF _invite.status = ''accepted'' AND _invite.invited_user_id = _uid THEN');
  definition := replace(definition,
    'IF NOT (' || chr(10) || '    _invite.invited_user_id = _uid',
    'IF NOT COALESCE((' || chr(10) || '    _invite.invited_user_id = _uid');
  definition := replace(definition,
    'AND _invite.invited_email IS NOT NULL' || chr(10) || '      AND _user_email IS NOT NULL' || chr(10) || '      AND lower(btrim(_invite.invited_email)) = lower(btrim(_user_email))',
    'AND (' || chr(10) || '        (NULLIF(btrim(_invite.invited_email), '''') IS NOT NULL AND _user_email IS NOT NULL' || chr(10) || '         AND lower(btrim(_invite.invited_email)) = lower(btrim(_user_email)))' || chr(10) || '        OR (NULLIF(btrim(_invite.invited_email), '''') IS NULL' || chr(10) || '            AND NULLIF(btrim(_invite_token), '''') IS NOT NULL' || chr(10) || '            AND _invite.invite_token = _invite_token)' || chr(10) || '      )');
  definition := replace(definition,
    '  ) THEN' || chr(10) || '    RAISE EXCEPTION ''invite_not_for_this_user''',
    '  ), false) THEN' || chr(10) || '    RAISE EXCEPTION ''invite_not_for_this_user''');
  EXECUTE definition;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.get_email_signup_invite_refusal(_token text, _email text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE inv record; allowed jsonb; club uuid;
BEGIN
  IF public.email_signup_invite_allowed(_token, _email) IS DISTINCT FROM false THEN RETURN NULL; END IF;
  IF NULLIF(btrim(_token), '') IS NULL THEN RETURN 'invite_required'; END IF;
  SELECT value->'emailAuthClubs' INTO allowed FROM public.app_settings WHERE key='backend_routing_config';
  SELECT pi.*, COALESCE(pi.club_id,t.club_id) AS effective_club INTO inv
  FROM public.pending_invites pi LEFT JOIN public.teams t ON t.id=pi.team_id
  WHERE pi.invite_token=_token;
  IF FOUND THEN
    IF inv.status = 'expired' THEN RETURN 'invite_expired'; END IF;
    IF inv.status <> 'pending' OR inv.invited_user_id IS NOT NULL THEN RETURN 'invite_used'; END IF;
    IF NULLIF(btrim(inv.invited_email),'') IS NOT NULL
       AND lower(btrim(inv.invited_email)) IS DISTINCT FROM lower(btrim(_email)) THEN RETURN 'invite_email_mismatch'; END IF;
    club := inv.effective_club;
  ELSE
    SELECT ti.expires_at,ti.max_uses,ti.uses_count,t.club_id INTO inv
    FROM public.team_invites ti JOIN public.teams t ON t.id=ti.team_id WHERE ti.token=_token;
    IF NOT FOUND THEN
      SELECT ci.expires_at,ci.max_uses,ci.uses_count,ci.club_id INTO inv FROM public.club_invites ci WHERE ci.token=_token;
    END IF;
    IF NOT FOUND THEN RETURN 'invite_not_found'; END IF;
    IF inv.expires_at IS NOT NULL AND inv.expires_at <= now() THEN RETURN 'invite_expired'; END IF;
    IF inv.max_uses IS NOT NULL AND (inv.uses_count IS NULL OR inv.uses_count >= inv.max_uses) THEN RETURN 'invite_used'; END IF;
    club := inv.club_id;
  END IF;
  IF jsonb_typeof(allowed) IS DISTINCT FROM 'array' THEN RETURN 'invite_club_not_email_enabled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a WHERE lower(a->>'id')=club::text) THEN
    RETURN 'invite_club_not_email_enabled';
  END IF;
  RETURN 'invite_invalid';
END;
$$;
REVOKE ALL ON FUNCTION public.get_email_signup_invite_refusal(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_signup_invite_refusal(text,text) TO anon, authenticated, service_role;