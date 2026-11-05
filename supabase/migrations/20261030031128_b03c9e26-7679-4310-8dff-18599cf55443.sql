DO $$ BEGIN IF (SELECT system_identifier::text FROM pg_control_system()) <> '7581440907192989109' THEN RAISE EXCEPTION 'DEV database only'; END IF; END $$;
CREATE POLICY "Read own competition role" ON public.competition_roles FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
CREATE OR REPLACE FUNCTION public.remove_exact_competition_role(p_id uuid,p_competition_id uuid,p_user_id uuid,p_role text) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE target public.competition_roles%ROWTYPE; caller uuid:=auth.uid(); removed uuid;
BEGIN
 IF caller IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT * INTO target FROM public.competition_roles WHERE id=p_id AND competition_id=p_competition_id AND user_id=p_user_id AND role::text=p_role;
 IF NOT FOUND THEN RAISE EXCEPTION 'Exact competition role not found'; END IF;
 IF target.role::text='owner' THEN RAISE EXCEPTION 'Owner roles cannot be removed' USING ERRCODE='42501'; END IF;
 IF target.user_id<>caller AND NOT public.is_competition_admin(caller,target.competition_id) THEN RAISE EXCEPTION 'Competition management forbidden' USING ERRCODE='42501'; END IF;
 DELETE FROM public.competition_roles WHERE id=target.id AND competition_id=target.competition_id AND user_id=target.user_id AND role=target.role RETURNING id INTO removed;
 IF removed IS NULL OR EXISTS(SELECT 1 FROM public.competition_roles WHERE id=target.id) THEN RAISE EXCEPTION 'Role removal was not confirmed'; END IF;
 RETURN true;
END $$;