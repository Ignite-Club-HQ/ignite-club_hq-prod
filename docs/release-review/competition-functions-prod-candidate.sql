-- PROD structural candidate; local rehearsal only until exact target review.
-- No score copying/clearing, bucket writes, policy replacements or old link changes.
-- CREATE (not REPLACE) fails on unexpected existing target contracts.

CREATE FUNCTION public.can_view_competition_fixture_event(_match_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.competition_matches cm
   JOIN public.competitions c ON c.id=cm.competition_id
   WHERE cm.id=_match_id AND (
     EXISTS (SELECT 1 FROM public.competition_roles cr WHERE cr.competition_id=c.id
       AND cr.user_id=auth.uid() AND cr.role IN ('owner','admin'))
     OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.club_id=c.organizer_club_id
       AND ur.user_id=auth.uid() AND ur.role='league_admin')))
$$;
CREATE FUNCTION public.get_my_viewable_competition_match_ids()
RETURNS TABLE(match_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT cm.id FROM public.competition_matches cm
 WHERE public.can_view_competition_fixture_event(cm.id)
$$;
REVOKE ALL ON FUNCTION public.can_view_competition_fixture_event(uuid),public.get_my_viewable_competition_match_ids() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_competition_fixture_event(uuid),public.get_my_viewable_competition_match_ids() TO authenticated,service_role;
CREATE POLICY competition_admins_read_fixture_events ON public.events AS PERMISSIVE FOR SELECT TO authenticated
 USING (competition_match_id IS NOT NULL AND public.can_view_competition_fixture_event(competition_match_id));

-- Preserve PROD's existing manager-only competition Vault boundary.
-- Existing folder/file/chat restrictions and Storage policies remain authoritative.
CREATE FUNCTION public.can_manage_competition_vault(_competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.competitions c
   WHERE c.id=_competition_id AND public.is_competition_admin(auth.uid(),c.id))
$$;
CREATE FUNCTION public.can_access_competition_vault(_competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.can_manage_competition_vault(_competition_id)
$$;
REVOKE ALL ON FUNCTION public.can_manage_competition_vault(uuid),public.can_access_competition_vault(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_competition_vault(uuid),public.can_access_competition_vault(uuid) TO authenticated,service_role;

CREATE TABLE public.competition_role_email_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 token text NOT NULL UNIQUE CHECK(char_length(token) BETWEEN 32 AND 128),
 competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('referee','committee_member')),
 invited_email text NOT NULL,
 verification_code_hash text NOT NULL CHECK(verification_code_hash ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked','locked')),
 attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '48 hours',
 accepted_user_id uuid REFERENCES public.profiles(id),
 accepted_at timestamptz
);
GRANT SELECT ON public.competition_role_email_invites TO authenticated;
GRANT ALL ON public.competition_role_email_invites TO service_role;
REVOKE ALL ON public.competition_role_email_invites FROM PUBLIC,anon;
ALTER TABLE public.competition_role_email_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY competition_role_email_invites_select_manager ON public.competition_role_email_invites
 FOR SELECT TO authenticated USING(public.is_competition_admin(auth.uid(),competition_id));
CREATE INDEX competition_role_email_invites_manager_idx ON public.competition_role_email_invites(competition_id,created_at DESC);

CREATE FUNCTION public.create_competition_role_email_invite(
 _competition_id uuid,_role text,_token text,_email text,_verification_code_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_email text:=lower(btrim(coalesce(_email,''))); v_id uuid;
BEGIN
 IF v_uid IS NULL OR NOT coalesce(public.is_competition_admin(v_uid,_competition_id),false)
 THEN RAISE EXCEPTION 'Competition admin required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.competitions WHERE id=_competition_id AND status<>'archived')
 THEN RAISE EXCEPTION 'Competition unavailable'; END IF;
 IF _role IS NULL OR _role NOT IN ('referee','committee_member') THEN RAISE EXCEPTION 'Invalid official role'; END IF;
 IF _token IS NULL OR char_length(_token) NOT BETWEEN 32 AND 128 THEN RAISE EXCEPTION 'Invalid invitation token'; END IF;
 IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' THEN RAISE EXCEPTION 'Invalid email address'; END IF;
 IF _verification_code_hash IS NULL OR _verification_code_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid verification code'; END IF;
 INSERT INTO public.competition_role_email_invites(token,competition_id,role,invited_email,verification_code_hash,created_by)
 VALUES(_token,_competition_id,_role,v_email,_verification_code_hash,v_uid) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION public.get_competition_role_email_invite_status(p_token text)
RETURNS TABLE(status text,competition_id uuid,competition_name text,role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN c.id IS NULL OR i.status IN ('revoked','locked') THEN 'invalid'
   WHEN i.status='accepted' THEN 'used' WHEN i.expires_at<=now() THEN 'expired'
   WHEN c.status='archived' THEN 'archived' ELSE 'valid' END,
   i.competition_id,c.name,i.role
 FROM public.competition_role_email_invites i LEFT JOIN public.competitions c ON c.id=i.competition_id
 WHERE i.token=p_token AND char_length(p_token) BETWEEN 32 AND 128
 UNION ALL SELECT 'invalid',NULL::uuid,NULL::text,NULL::text
 WHERE NOT EXISTS(SELECT 1 FROM public.competition_role_email_invites i WHERE i.token=p_token)
 LIMIT 1
$$;

CREATE FUNCTION public.accept_competition_role_email_invite(p_token text,p_verification_code_hash text)
RETURNS TABLE(status text,competition_id uuid,role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_email text; v_confirmed timestamptz;
 v_invite public.competition_role_email_invites%ROWTYPE; v_name text; v_club uuid;
 v_db_role text; v_inserted integer;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT lower(btrim(u.email)),u.email_confirmed_at INTO v_email,v_confirmed FROM auth.users u WHERE u.id=v_uid;
 IF v_email IS NULL OR v_confirmed IS NULL THEN
   RETURN QUERY SELECT 'email_unverified'::text,NULL::uuid,NULL::text; RETURN; END IF;
 SELECT * INTO v_invite FROM public.competition_role_email_invites i WHERE i.token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::text; RETURN; END IF;
 IF v_invite.status='accepted' AND v_invite.accepted_user_id=v_uid THEN
   RETURN QUERY SELECT 'already'::text,v_invite.competition_id,v_invite.role; RETURN; END IF;
 IF v_invite.status<>'pending' OR v_invite.expires_at<=now() THEN
   RETURN QUERY SELECT 'invalid'::text,v_invite.competition_id,v_invite.role; RETURN; END IF;
 IF v_email IS DISTINCT FROM lower(btrim(v_invite.invited_email))
    OR p_verification_code_hash IS DISTINCT FROM v_invite.verification_code_hash THEN
   UPDATE public.competition_role_email_invites i SET attempts=i.attempts+1,
     status=CASE WHEN i.attempts+1>=5 THEN 'locked' ELSE i.status END WHERE i.id=v_invite.id;
   RETURN QUERY SELECT CASE WHEN v_invite.attempts+1>=5 THEN 'locked' ELSE 'code_invalid' END,
     v_invite.competition_id,v_invite.role; RETURN;
 END IF;
 SELECT c.name,c.organizer_club_id INTO v_name,v_club FROM public.competitions c
 WHERE c.id=v_invite.competition_id AND c.status<>'archived' FOR SHARE;
 IF NOT FOUND THEN RETURN QUERY SELECT 'archived'::text,v_invite.competition_id,v_invite.role; RETURN; END IF;
 -- Existing DEV/PROD role vocabulary is committee, UI invitation role is committee_member.
 v_db_role:=CASE WHEN v_invite.role='committee_member' THEN 'committee' ELSE v_invite.role END;
 INSERT INTO public.competition_roles(competition_id,user_id,role)
 VALUES(v_invite.competition_id,v_uid,v_db_role)
 ON CONFLICT ON CONSTRAINT competition_roles_competition_id_user_id_role_key DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 IF v_inserted=1 THEN
   INSERT INTO public.notifications(user_id,type,message,related_id,club_id)
   VALUES(v_uid,'membership','You joined as a '||replace(v_invite.role,'_',' ')||' for '||v_name,v_invite.competition_id,v_club);
 END IF;
 UPDATE public.competition_role_email_invites i SET status='accepted',accepted_user_id=v_uid,accepted_at=now() WHERE i.id=v_invite.id;
 RETURN QUERY SELECT CASE WHEN v_inserted=1 THEN 'joined' ELSE 'already' END,v_invite.competition_id,v_invite.role;
END $$;

CREATE FUNCTION public.revoke_competition_role_email_invite(_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 UPDATE public.competition_role_email_invites i SET status='revoked'
 WHERE i.token=_token AND i.status='pending' AND public.is_competition_admin(auth.uid(),i.competition_id);
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.create_competition_role_email_invite(uuid,text,text,text,text),public.accept_competition_role_email_invite(text,text),public.revoke_competition_role_email_invite(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_competition_role_email_invite_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_competition_role_email_invite(uuid,text,text,text,text),public.accept_competition_role_email_invite(text,text),public.revoke_competition_role_email_invite(text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_competition_role_email_invite_status(text) TO anon,authenticated,service_role;