DO $$ BEGIN IF (SELECT system_identifier::text FROM pg_control_system()) <> '7581440907192989109' THEN RAISE EXCEPTION 'DEV database only'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.remove_exact_competition_role(p_id uuid, p_competition_id uuid, p_user_id uuid, p_role text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target public.competition_roles%ROWTYPE; caller uuid := auth.uid();
BEGIN
 IF caller IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT * INTO target FROM public.competition_roles WHERE id=p_id AND competition_id=p_competition_id AND user_id=p_user_id AND role::text=p_role FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Exact competition role not found'; END IF;
 IF target.role::text='owner' THEN RAISE EXCEPTION 'Owner roles cannot be removed' USING ERRCODE='42501'; END IF;
 IF target.user_id<>caller AND NOT public.is_competition_admin(caller,target.competition_id) THEN RAISE EXCEPTION 'Competition management forbidden' USING ERRCODE='42501'; END IF;
 DELETE FROM public.competition_roles WHERE id=target.id AND competition_id=target.competition_id AND user_id=target.user_id AND role=target.role;
 IF EXISTS(SELECT 1 FROM public.competition_roles WHERE id=target.id) THEN RAISE EXCEPTION 'Role removal was not confirmed'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.remove_exact_competition_role(uuid,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_exact_competition_role(uuid,uuid,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.guard_competition_owner_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.role::text='owner' AND EXISTS(SELECT 1 FROM public.competitions WHERE id=OLD.competition_id) THEN RAISE EXCEPTION 'Owner roles cannot be removed' USING ERRCODE='42501'; END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.guard_competition_owner_delete() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_competition_owner_delete BEFORE DELETE ON public.competition_roles FOR EACH ROW EXECUTE FUNCTION public.guard_competition_owner_delete();