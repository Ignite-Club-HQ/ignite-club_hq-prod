-- Synthetic local-only stand-ins, NOT a production schema reconstruction.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users);
GRANT ALL ON public.profiles TO service_role;
CREATE TABLE public.claim_audit(id uuid PRIMARY KEY REFERENCES auth.users);
GRANT ALL ON public.claim_audit TO service_role;
CREATE TABLE public.app_settings(key text PRIMARY KEY, value jsonb);
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY existing_authenticated_settings ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE TABLE public.teams(id uuid PRIMARY KEY, club_id uuid);
GRANT ALL ON public.teams TO service_role;
CREATE TABLE public.pending_invites(invite_token text, status text, invited_user_id uuid, invited_email text, team_id uuid, club_id uuid);
GRANT ALL ON public.pending_invites TO service_role;
CREATE TABLE public.team_invites(token text, team_id uuid, expires_at timestamptz, max_uses integer, uses_count integer);
GRANT ALL ON public.team_invites TO service_role;
CREATE TABLE public.club_invites(token text, club_id uuid, expires_at timestamptz, max_uses integer, uses_count integer);
GRANT ALL ON public.club_invites TO service_role;
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.profiles(id) VALUES (NEW.id); RETURN NEW; END; $$;
CREATE FUNCTION public.synthetic_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.claim_audit(id) VALUES (NEW.id); RETURN NEW; END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER trg_auto_claim_eois AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.synthetic_claim();
CREATE TEMP TABLE original_definitions AS
SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) AS profile,
 (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'on_auth_user_created') AS profile_trigger,
 (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_auto_claim_eois') AS claims_trigger;
INSERT INTO public.app_settings VALUES
 ('backend_routing_config', '{"emailAuthClubs":[{"id":"00000000-0000-0000-0000-000000000001"},{"id":"00000000-0000-0000-0000-000000000002"}]}'),
 ('private_setting', '"synthetic private value"');
INSERT INTO public.teams VALUES
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000003');
INSERT INTO public.team_invites VALUES
 ('team-one','00000000-0000-0000-0000-000000000011',now()+interval '1 day',1,0),
 ('team-two','00000000-0000-0000-0000-000000000012',NULL,NULL,NULL),
 ('other-club','00000000-0000-0000-0000-000000000013',NULL,NULL,0),
 ('expired','00000000-0000-0000-0000-000000000011',now()-interval '1 day',NULL,0),
 ('exhausted','00000000-0000-0000-0000-000000000011',NULL,1,1),
 ('negative','00000000-0000-0000-0000-000000000011',NULL,NULL,-1),
 ('unknown-count','00000000-0000-0000-0000-000000000011',NULL,1,NULL);
INSERT INTO public.club_invites VALUES ('club-two','00000000-0000-0000-0000-000000000002',NULL,2,1);
INSERT INTO public.pending_invites VALUES
 ('pending','pending',NULL,' invited@example.test ',NULL,'00000000-0000-0000-0000-000000000001'),
 ('conflict','pending',NULL,'invited@example.test','00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001'),
 ('claimed','pending','00000000-0000-0000-0000-000000000099','invited@example.test',NULL,'00000000-0000-0000-0000-000000000001');