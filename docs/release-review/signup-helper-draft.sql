-- ISOLATED REHEARSAL DRAFT ONLY. Never install via ordinary migrations.
-- Explicitly unarmed configuration keeps email open; malformed armed settings deny.
-- This authorizes eligibility only; it does not consume/reserve invite uses.
CREATE FUNCTION public.email_signup_invite_allowed(_token text, _email text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE config jsonb; allowed jsonb;
BEGIN
 SELECT value INTO config FROM public.app_settings WHERE key = 'backend_routing_config';
 IF config IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(config) <> 'object' THEN RETURN false; END IF;
 allowed := config->'emailAuthClubs';
 IF allowed IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(allowed) <> 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(allowed) = 0 THEN RETURN true; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a
   WHERE jsonb_typeof(a) <> 'object' OR coalesce(a->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(allowed)) <>
    (SELECT count(DISTINCT lower(a->>'id')) FROM jsonb_array_elements(allowed) a) THEN RETURN false; END IF;
 IF nullif(btrim(_token),'') IS NULL OR nullif(btrim(_email),'') IS NULL THEN RETURN false; END IF;
 RETURN EXISTS (
   SELECT 1 FROM public.pending_invites pi LEFT JOIN public.teams t ON t.id = pi.team_id
   WHERE pi.invite_token = _token AND pi.status = 'pending' AND pi.invited_user_id IS NULL
     AND lower(btrim(pi.invited_email)) = lower(btrim(_email))
     AND (pi.team_id IS NULL OR (t.id IS NOT NULL AND (pi.club_id IS NULL OR pi.club_id = t.club_id)))
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a WHERE lower(a->>'id') = coalesce(pi.club_id,t.club_id)::text)
 ) OR EXISTS (
   SELECT 1 FROM public.team_invites ti JOIN public.teams t ON t.id = ti.team_id
   WHERE ti.token = _token AND (ti.expires_at IS NULL OR ti.expires_at > now())
     AND (ti.uses_count IS NULL OR ti.uses_count >= 0)
     AND (ti.max_uses IS NULL OR (ti.max_uses > 0 AND ti.uses_count >= 0 AND ti.uses_count < ti.max_uses))
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a WHERE lower(a->>'id') = t.club_id::text)
 ) OR EXISTS (
   SELECT 1 FROM public.club_invites ci WHERE ci.token = _token
     AND (ci.expires_at IS NULL OR ci.expires_at > now())
     AND (ci.uses_count IS NULL OR ci.uses_count >= 0)
     AND (ci.max_uses IS NULL OR (ci.max_uses > 0 AND ci.uses_count >= 0 AND ci.uses_count < ci.max_uses))
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(allowed) a WHERE lower(a->>'id') = ci.club_id::text)
 );
END;
$$;
REVOKE ALL ON FUNCTION public.email_signup_invite_allowed(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_signup_invite_allowed(text,text) TO service_role;