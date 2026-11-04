-- Exact structural candidate; not deployed. No seed messages/sender/accounts.
-- CREATE fails if target objects unexpectedly exist; never replaces live flows.
CREATE TABLE public.club_invite_message_defaults (
 club_id uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
 message text NOT NULL
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.club_invite_message_defaults TO authenticated;
GRANT ALL ON public.club_invite_message_defaults TO service_role;
REVOKE ALL ON public.club_invite_message_defaults FROM PUBLIC,anon;
ALTER TABLE public.club_invite_message_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY club_members_read_invite_default ON public.club_invite_message_defaults
 FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.user_roles ur
 WHERE ur.club_id=club_invite_message_defaults.club_id AND ur.user_id=auth.uid()));
CREATE POLICY club_admins_insert_invite_default ON public.club_invite_message_defaults
 FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles ur
 WHERE ur.club_id=club_invite_message_defaults.club_id AND ur.user_id=auth.uid() AND ur.role='club_admin'));
CREATE POLICY club_admins_update_invite_default ON public.club_invite_message_defaults
 FOR UPDATE TO authenticated
 USING(EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.club_id=club_invite_message_defaults.club_id AND ur.user_id=auth.uid() AND ur.role='club_admin'))
 WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.club_id=club_invite_message_defaults.club_id AND ur.user_id=auth.uid() AND ur.role='club_admin'));
CREATE POLICY club_admins_delete_invite_default ON public.club_invite_message_defaults
 FOR DELETE TO authenticated USING(EXISTS(SELECT 1 FROM public.user_roles ur
 WHERE ur.club_id=club_invite_message_defaults.club_id AND ur.user_id=auth.uid() AND ur.role='club_admin'));

CREATE FUNCTION public.send_welcome_dm(p_user_id uuid,p_message text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_system uuid:='00000000-0000-0000-0000-000000000001';
 v_conv uuid; v_p1 uuid; v_p2 uuid; v_text text;
BEGIN
 IF auth.uid() IS NULL OR auth.uid()<>p_user_id OR p_user_id IS NULL OR p_user_id=v_system
 THEN RAISE EXCEPTION 'not authorized'; END IF;
 -- Serialize all welcome attempts for the same caller, across devices.
 PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_system) THEN RETURN NULL; END IF;
 v_text:=left(coalesce(nullif(trim(p_message),''),
   'Welcome to Ignite! I''m here if you need a hand getting your club set up — just reply to this message any time.'),4000);
 v_p1:=least(v_system,p_user_id); v_p2:=greatest(v_system,p_user_id);
 SELECT id INTO v_conv FROM public.direct_conversations WHERE participant_1=v_p1 AND participant_2=v_p2;
 IF v_conv IS NULL THEN
   INSERT INTO public.direct_conversations(participant_1,participant_2,created_by)
   VALUES(v_p1,v_p2,p_user_id) ON CONFLICT(participant_1,participant_2) DO NOTHING RETURNING id INTO v_conv;
   IF v_conv IS NULL THEN SELECT id INTO v_conv FROM public.direct_conversations WHERE participant_1=v_p1 AND participant_2=v_p2; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.direct_messages WHERE conversation_id=v_conv AND author_id=v_system) THEN
   INSERT INTO public.direct_messages(conversation_id,author_id,text,is_system_message) VALUES(v_conv,v_system,v_text,true);
 END IF;
 RETURN v_conv;
END $$;
REVOKE ALL ON FUNCTION public.send_welcome_dm(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.send_welcome_dm(uuid,text) TO authenticated,service_role;