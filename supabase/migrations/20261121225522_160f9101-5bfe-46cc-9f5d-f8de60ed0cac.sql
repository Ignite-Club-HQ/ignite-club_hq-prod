DO $dev$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7581440907192989109' THEN RETURN; END IF;
 EXECUTE $repair$
CREATE OR REPLACE FUNCTION public.onboarding_platform_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='app_admin' AND club_id IS NULL AND team_id IS NULL)
$$;
REVOKE ALL ON FUNCTION public.onboarding_platform_admin(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.onboarding_platform_admin(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.enforce_onboarding_role_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid := auth.uid(); team_club uuid;
BEGIN
 IF uid IS NULL THEN
   IF current_setting('role',true)='service_role' OR session_user IN ('postgres','supabase_admin','rehearsal') THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Sign in to manage memberships.' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.user_id,NEW.role,NEW.club_id,NEW.team_id) IS NOT DISTINCT FROM ROW(OLD.user_id,OLD.role,OLD.club_id,OLD.team_id) THEN RETURN NEW; END IF;
 IF NEW.role='app_admin' AND (NOT public.onboarding_platform_admin(uid) OR NEW.club_id IS NOT NULL OR NEW.team_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Only a platform administrator can grant platform access.' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND OLD.role='app_admin' AND NOT public.onboarding_platform_admin(uid) THEN
   RAISE EXCEPTION 'Only a platform administrator can change platform access.' USING ERRCODE='42501';
 END IF;
 IF NEW.team_id IS NOT NULL THEN
   SELECT club_id INTO team_club FROM public.teams WHERE id=NEW.team_id;
   IF team_club IS NULL OR NEW.club_id IS DISTINCT FROM team_club THEN RAISE EXCEPTION 'The team and club must match.' USING ERRCODE='42501'; END IF;
   IF NEW.role NOT IN ('player','parent','coach','team_admin') THEN RAISE EXCEPTION 'This role cannot be assigned to a team.' USING ERRCODE='42501'; END IF;
 END IF;
 IF NEW.club_id IS NULL AND NEW.team_id IS NULL AND NEW.role <> 'basic_user' AND NOT public.onboarding_platform_admin(uid) THEN
   RAISE EXCEPTION 'Platform access requires a platform administrator.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_onboarding_role_scope() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER onboarding_role_scope BEFORE INSERT OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.enforce_onboarding_role_scope();
CREATE OR REPLACE FUNCTION public.onboarding_can_manage_role(_uid uuid,_role public.app_role,_club uuid,_team uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.onboarding_platform_admin(_uid) OR (
  _club IS NOT NULL AND _role<>'app_admin' AND
  ((_team IS NULL AND _role IN ('club_admin','player','parent','coach','committee_member','league_admin','association_admin','competition_admin','basic_user')
    AND public.has_role(_uid,'club_admin',_club,NULL))
   OR (_team IS NOT NULL AND _role IN ('player','parent','coach','team_admin')
    AND EXISTS(SELECT 1 FROM public.teams WHERE id=_team AND club_id=_club)
    AND (public.has_role(_uid,'club_admin',_club,NULL) OR public.has_role(_uid,'team_admin',NULL,_team)))))
$$;
REVOKE ALL ON FUNCTION public.onboarding_can_manage_role(uuid,public.app_role,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.onboarding_can_manage_role(uuid,public.app_role,uuid,uuid) TO authenticated,service_role;
DROP POLICY IF EXISTS "Club admins can manage roles" ON public.user_roles;
CREATE POLICY "Club admins can manage roles" ON public.user_roles FOR ALL TO authenticated
 USING(public.onboarding_can_manage_role(auth.uid(),role,club_id,team_id))
 WITH CHECK(public.onboarding_can_manage_role(auth.uid(),role,club_id,team_id));
CREATE OR REPLACE FUNCTION public.onboarding_can_manage_child(_uid uuid,_child uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.onboarding_platform_admin(_uid) OR EXISTS (
  SELECT 1 FROM public.child_team_assignments ca JOIN public.teams t ON t.id=ca.team_id
  WHERE ca.child_id=_child AND (public.has_role(_uid,'club_admin',t.club_id,NULL)
   OR public.has_role(_uid,'team_admin',NULL,t.id) OR public.has_role(_uid,'coach',NULL,t.id)))
$$;
REVOKE ALL ON FUNCTION public.onboarding_can_manage_child(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.onboarding_can_manage_child(uuid,uuid) TO authenticated,service_role;
DROP POLICY IF EXISTS "Admins can insert child guardians for their teams" ON public.child_guardians;
CREATE POLICY "Admins can insert child guardians for their teams" ON public.child_guardians FOR INSERT TO authenticated
 WITH CHECK(public.onboarding_can_manage_child(auth.uid(),child_id));
CREATE OR REPLACE FUNCTION public.onboarding_can_create_child(_uid uuid,_parent uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT _uid=_parent OR public.onboarding_platform_admin(_uid) OR EXISTS (
  SELECT 1 FROM public.user_roles staff JOIN public.user_roles parent_role
   ON parent_role.user_id=_parent AND parent_role.role IN ('parent','player')
  LEFT JOIN public.teams pt ON pt.id=parent_role.team_id
  WHERE staff.user_id=_uid AND (
   (staff.role='club_admin' AND staff.club_id IS NOT NULL AND staff.club_id=COALESCE(parent_role.club_id,pt.club_id))
   OR (staff.role IN ('team_admin','coach') AND staff.team_id IS NOT NULL AND staff.team_id=parent_role.team_id)))
$$;
REVOKE ALL ON FUNCTION public.onboarding_can_create_child(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.onboarding_can_create_child(uuid,uuid) TO authenticated,service_role;
DROP POLICY IF EXISTS "Admins can create children for team members" ON public.children;
CREATE POLICY "Admins can create children for team members" ON public.children FOR INSERT TO authenticated
 WITH CHECK(public.onboarding_can_create_child(auth.uid(),parent_id));
CREATE OR REPLACE FUNCTION public.require_icp_new_club()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_setting('role',true)='service_role' OR (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin','rehearsal')) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'New clubs require Internet Identity. Existing email clubs and teams are unchanged.' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.require_icp_new_club() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER require_icp_new_club BEFORE INSERT ON public.clubs FOR EACH ROW EXECUTE FUNCTION public.require_icp_new_club();
CREATE OR REPLACE FUNCTION public.accept_legacy_club_invite(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid := auth.uid(); inv public.club_invites%ROWTYPE; already boolean;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in with email to accept this invitation.' USING ERRCODE='42501'; END IF;
 SELECT * INTO inv FROM public.club_invites WHERE token=_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'This invitation was not found.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs WHERE id=inv.club_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'This club is no longer available.'; END IF;
 IF inv.role NOT IN ('player','parent','coach','team_admin','club_admin','committee_member','basic_user') THEN RAISE EXCEPTION 'This invitation role is not available.' USING ERRCODE='42501'; END IF;
 IF NOT (public.has_role(inv.created_by,'club_admin',inv.club_id,NULL) OR public.onboarding_platform_admin(inv.created_by)) THEN RAISE EXCEPTION 'Your organiser can no longer authorise this invitation.' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.club_member_exclusions WHERE club_id=inv.club_id AND user_id=uid) THEN RAISE EXCEPTION 'Please contact your club administrator about rejoining.' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=uid AND club_id=inv.club_id AND team_id IS NULL AND role=inv.role) INTO already;
 IF already THEN RETURN jsonb_build_object('club_id',inv.club_id,'role',inv.role,'already_member',true); END IF;
 IF inv.expires_at IS NOT NULL AND inv.expires_at<=now() THEN RAISE EXCEPTION 'This invitation has expired.'; END IF;
 IF inv.max_uses IS NOT NULL AND (inv.max_uses<=0 OR inv.uses_count IS NULL OR inv.uses_count>=inv.max_uses) THEN RAISE EXCEPTION 'This invitation has reached its usage limit.'; END IF;
 INSERT INTO public.user_roles(user_id,club_id,role) VALUES(uid,inv.club_id,inv.role);
 UPDATE public.club_invites SET uses_count=COALESCE(uses_count,0)+1 WHERE id=inv.id;
 RETURN jsonb_build_object('club_id',inv.club_id,'role',inv.role,'already_member',false);
END $$;
REVOKE ALL ON FUNCTION public.accept_legacy_club_invite(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_legacy_club_invite(text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_pending_invite_by_token(_token text)
RETURNS TABLE(id uuid,team_id uuid,club_id uuid,role text,invited_label text,invited_email text,status text,team_name text,team_logo_url text,club_name text,club_logo_url text,metadata jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT pi.id,pi.team_id,COALESCE(pi.club_id,t.club_id),pi.role::text,pi.invited_label,pi.invited_email,pi.status,
 t.name,t.logo_url,c.name,c.logo_url,pi.metadata FROM public.pending_invites pi
 LEFT JOIN public.teams t ON t.id=pi.team_id LEFT JOIN public.clubs c ON c.id=COALESCE(pi.club_id,t.club_id)
 WHERE pi.invite_token=_token
$$;
REVOKE ALL ON FUNCTION public.get_pending_invite_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_invite_by_token(text) TO anon,authenticated,service_role;
 $repair$;
END $dev$;