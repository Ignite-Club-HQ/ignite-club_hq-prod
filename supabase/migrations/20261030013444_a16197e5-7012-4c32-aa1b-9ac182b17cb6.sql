DO $$
DECLARE actor uuid; test_token text := 'email-signup-test-' || gen_random_uuid()::text; allowed_club uuid; result boolean;
BEGIN
 SELECT id INTO actor FROM auth.users ORDER BY created_at LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'Test requires an existing DEV user'; END IF;
 BEGIN
  INSERT INTO public.app_settings(key,value) VALUES ('backend_routing_config', jsonb_build_object('emailAuthClubs',jsonb_build_array(jsonb_build_object('id','966bdaec-ebf1-46da-b2b3-cc53bf05c422'),jsonb_build_object('id','493ee2e3-c834-487d-93be-d1c8a0dbc4a8'))))
  ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;
  IF public.email_signup_invite_allowed(NULL,'test@example.test') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Uninvited signup allowed'; END IF;
  FOREACH allowed_club IN ARRAY ARRAY['966bdaec-ebf1-46da-b2b3-cc53bf05c422'::uuid,'493ee2e3-c834-487d-93be-d1c8a0dbc4a8'::uuid] LOOP
   INSERT INTO public.club_invites(club_id,role,token,created_by,max_uses,uses_count,expires_at) VALUES (allowed_club,'player',test_token,actor,2,1,now()+interval '1 day');
   IF public.email_signup_invite_allowed(test_token,'test@example.test') IS DISTINCT FROM true THEN RAISE EXCEPTION 'Allowed club invitation rejected'; END IF;
   UPDATE public.club_invites SET uses_count=2 WHERE club_invites.token=test_token;
   IF public.email_signup_invite_allowed(test_token,'test@example.test') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Exhausted invitation allowed'; END IF;
   UPDATE public.club_invites SET uses_count=1,expires_at=now() WHERE club_invites.token=test_token;
   IF public.email_signup_invite_allowed(test_token,'test@example.test') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Expired invitation allowed'; END IF;
   DELETE FROM public.club_invites WHERE club_invites.token=test_token;
  END LOOP;
  SELECT id INTO allowed_club FROM public.clubs WHERE id NOT IN ('966bdaec-ebf1-46da-b2b3-cc53bf05c422','493ee2e3-c834-487d-93be-d1c8a0dbc4a8') LIMIT 1;
  IF allowed_club IS NOT NULL THEN
   INSERT INTO public.club_invites(club_id,role,token,created_by,max_uses,uses_count,expires_at) VALUES (allowed_club,'player',test_token,actor,2,0,now()+interval '1 day');
   IF public.email_signup_invite_allowed(test_token,'test@example.test') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Other club invitation allowed'; END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE='Z0001', MESSAGE='Rollback successful signup-policy test fixtures';
 EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
 END;
END;
$$;