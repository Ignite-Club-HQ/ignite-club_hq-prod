CREATE TEMP TABLE signup_cases(label text, token text, email text, expected boolean);
INSERT INTO signup_cases VALUES
 ('retained club one','team-one','invited@example.test',true),
 ('retained club two','team-two','invited@example.test',true),
 ('club invitation','club-two','invited@example.test',true),
 ('email normalized','pending',' INVITED@example.test ',true),
 ('outside retained clubs','other-club','invited@example.test',false),
 ('missing token',NULL,'invited@example.test',false),
 ('missing email','team-one',NULL,false),
 ('unknown token','unknown','invited@example.test',false),
 ('wrong email','pending','different@example.test',false),
 ('expired invite','expired','invited@example.test',false),
 ('exhausted invite','exhausted','invited@example.test',false),
 ('negative usage','negative','invited@example.test',false),
 ('unknown bounded usage','unknown-count','invited@example.test',false),
 ('conflicting team club','conflict','invited@example.test',false),
 ('claimed pending','claimed','invited@example.test',false);
DO $$
DECLARE c record; accepted boolean; before_count integer;
BEGIN
 FOR c IN SELECT * FROM signup_cases LOOP
   IF public.email_signup_invite_allowed(c.token,c.email) IS DISTINCT FROM c.expected THEN
     RAISE EXCEPTION 'Helper case failed: %',c.label;
   END IF;
   SELECT count(*) INTO before_count FROM public.profiles;
   accepted := true;
   BEGIN
     INSERT INTO auth.users VALUES(gen_random_uuid(),c.email,'{"provider":"email"}',jsonb_build_object('email_signup_invite_token',c.token));
   EXCEPTION WHEN SQLSTATE 'P0001' THEN accepted := false;
   END;
   IF accepted IS DISTINCT FROM c.expected THEN RAISE EXCEPTION 'Signup case failed: %',c.label; END IF;
   IF (SELECT count(*) FROM public.profiles) <> before_count + c.expected::integer THEN RAISE EXCEPTION 'Profile rollback failed: %',c.label; END IF;
   RAISE NOTICE 'PASS: %',c.label;
 END LOOP;
 IF has_function_privilege('anon','public.email_signup_invite_allowed(text,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.email_signup_invite_allowed(text,text)','EXECUTE') THEN RAISE EXCEPTION 'Helper publicly executable'; END IF;
 IF NOT has_function_privilege('service_role','public.email_signup_invite_allowed(text,text)','EXECUTE') THEN RAISE EXCEPTION 'Service helper inaccessible'; END IF;
 IF EXISTS (SELECT 1 FROM original_definitions WHERE profile <> pg_get_functiondef('public.handle_new_user()'::regprocedure)
    OR profile_trigger <> (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='on_auth_user_created')
    OR claims_trigger <> (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='trg_auto_claim_eois')) THEN RAISE EXCEPTION 'Existing account lifecycle changed'; END IF;
 IF (SELECT count(*) FROM public.profiles) <> (SELECT count(*) FROM public.claim_audit) THEN RAISE EXCEPTION 'AFTER triggers not both executed'; END IF;
END; $$;
-- Both explicit unarmed states preserve the existing open-email rule.
UPDATE public.app_settings SET value='{"emailAuthClubs":[]}' WHERE key='backend_routing_config';
DO $$ BEGIN
 IF public.email_signup_invite_allowed(NULL,NULL) IS NOT TRUE THEN RAISE EXCEPTION 'Empty list must keep email open'; END IF;
END; $$;
UPDATE public.app_settings SET value='{}' WHERE key='backend_routing_config';
DO $$ BEGIN
 IF public.email_signup_invite_allowed(NULL,NULL) IS NOT TRUE THEN RAISE EXCEPTION 'Unarmed settings must keep email open'; END IF;
END; $$;
UPDATE public.app_settings SET value='{"emailAuthClubs":[{"id":"bad"}]}' WHERE key='backend_routing_config';
DO $$ BEGIN
 IF public.email_signup_invite_allowed('team-one','invited@example.test') IS NOT FALSE THEN RAISE EXCEPTION 'Malformed armed config allowed'; END IF;
END; $$;
UPDATE public.app_settings SET value='{"emailAuthClubs":"bad"}' WHERE key='backend_routing_config';
DO $$ BEGIN
 IF public.email_signup_invite_allowed('team-one','invited@example.test') IS NOT FALSE THEN RAISE EXCEPTION 'Non-array config allowed'; END IF;
END; $$;
-- Unknown helper results must reject rather than silently allow account creation.
CREATE OR REPLACE FUNCTION public.email_signup_invite_allowed(_token text,_email text) RETURNS boolean LANGUAGE sql AS 'SELECT NULL::boolean';
DO $$ DECLARE rejected boolean := false; BEGIN
 BEGIN INSERT INTO auth.users VALUES(gen_random_uuid(),'null@example.test','{"provider":"email"}','{}');
 EXCEPTION WHEN SQLSTATE 'P0001' THEN rejected := true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'NULL decision allowed'; END IF;
 INSERT INTO auth.users VALUES(gen_random_uuid(),'other@example.test','{"provider":"google"}','{}');
END; $$;
SET ROLE anon;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.app_settings) <> 1 THEN RAISE EXCEPTION 'Anonymous settings access escaped routing row'; END IF;
END; $$;
RESET ROLE;
SELECT 'PASS: synthetic signup, lifecycle, helper ACL and anonymous routing checks' AS result;