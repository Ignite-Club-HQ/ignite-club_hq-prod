-- Batch 4 (approved Paul Cranwell, 5 Nov 2026): club invitation message defaults. Structural only.
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
