CREATE OR REPLACE FUNCTION public.email_signup_invite_allowed(_token text, _email text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE config jsonb; allowed jsonb;
BEGIN
 SELECT value INTO config FROM public.app_settings WHERE key = 'backend_routing_config';
 allowed := config->'emailAuthClubs';
 IF allowed IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(allowed) <> 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(allowed) = 0 THEN RETURN NULL; END IF;
 IF nullif(btrim(_token), '') IS NULL OR nullif(btrim(_email), '') IS NULL THEN RETURN false; END IF;
 RETURN EXISTS (
   SELECT 1 FROM public.pending_invites pi LEFT JOIN public.teams t ON t.id = pi.team_id
   WHERE pi.invite_token = _token AND pi.status = 'pending'
     AND pi.invited_user_id IS NULL
     AND lower(btrim(pi.invited_email)) = lower(btrim(_email))
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a WHERE lower(a->>'id') = COALESCE(pi.club_id,t.club_id)::text)
 ) OR EXISTS (
   SELECT 1 FROM public.team_invites ti JOIN public.teams t ON t.id = ti.team_id
   WHERE ti.token = _token AND (ti.expires_at IS NULL OR ti.expires_at > now())
     AND (ti.max_uses IS NULL OR ti.uses_count < ti.max_uses)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a WHERE lower(a->>'id') = t.club_id::text)
 ) OR EXISTS (
   SELECT 1 FROM public.club_invites ci WHERE ci.token = _token
     AND (ci.expires_at IS NULL OR ci.expires_at > now())
     AND (ci.max_uses IS NULL OR ci.uses_count < ci.max_uses)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a WHERE lower(a->>'id') = ci.club_id::text)
 );
END;
$$;
REVOKE ALL ON FUNCTION public.email_signup_invite_allowed(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_signup_invite_allowed(text,text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
 IF COALESCE(new.raw_app_meta_data->>'provider','email') = 'email'
    AND public.email_signup_invite_allowed(new.raw_user_meta_data->>'email_signup_invite_token',new.email) IS FALSE THEN
   RAISE EXCEPTION 'Email signup requires a valid invitation for an email-enabled club.' USING ERRCODE = 'P0001';
 END IF;
 INSERT INTO public.profiles (id) VALUES (new.id);
 RETURN new;
END;
$$;