"""Exact candidate SQL on a disposable socket-only cluster; no hosted credentials."""
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
OWNER = '10000000-0000-0000-0000-000000000001'
INVITEE = '10000000-0000-0000-0000-000000000002'
OTHER = '10000000-0000-0000-0000-000000000003'
LEAGUE = '10000000-0000-0000-0000-000000000004'
COMP = '20000000-0000-0000-0000-000000000001'
OTHER_COMP = '20000000-0000-0000-0000-000000000002'
CLUB = '30000000-0000-0000-0000-000000000001'
MATCH = '40000000-0000-0000-0000-000000000001'
TOKEN = 'a' * 64
HASH = 'b' * 64

class CompetitionContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='ignite-competition-sql-')
        cls.directory = pathlib.Path(cls.tmp.name)
        cls.root = os.geteuid() == 0
        if cls.root:
            os.chown(cls.directory, 1000, 1000)
        cls.env = {'PATH': os.environ['PATH'], 'HOME': str(cls.directory), 'LANG': 'C.UTF-8'}
        cls.started = False
        try:
            cls.command('initdb', '-D', str(cls.directory/'db'), '-U', 'rehearsal', '-A', 'trust', '--no-locale')
            cls.command('pg_ctl', '-D', str(cls.directory/'db'), '-l', str(cls.directory/'log'), '-o', f"-c listen_addresses='' -k {cls.directory} -p 55443", '-w', 'start')
            cls.started = True
            cls.sql("""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.competitions(id uuid PRIMARY KEY,name text,organizer_club_id uuid,status text);
CREATE TABLE public.competition_roles(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,competition_id uuid,user_id uuid,role text CHECK(role IN ('owner','admin','referee','scorer','committee')),UNIQUE(competition_id,user_id,role));
CREATE TABLE public.user_roles(user_id uuid,club_id uuid,role text);
CREATE TABLE public.competition_matches(id uuid PRIMARY KEY,competition_id uuid,home_score int,away_score int);
CREATE TABLE public.events(id uuid PRIMARY KEY,competition_match_id uuid,home_score int,away_score int);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.events TO authenticated;
CREATE TABLE public.notifications(user_id uuid,type text,message text,related_id uuid,club_id uuid);
CREATE TABLE public.trigger_log(competition_id uuid,user_id uuid,role text);
CREATE FUNCTION public.existing_role_sync() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.trigger_log VALUES(NEW.competition_id,NEW.user_id,NEW.role); RETURN NEW; END $$;
CREATE TRIGGER existing_role_sync AFTER INSERT ON public.competition_roles FOR EACH ROW EXECUTE FUNCTION public.existing_role_sync();
CREATE FUNCTION public.is_competition_admin(_user_id uuid,_competition_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.competition_roles WHERE user_id=_user_id AND competition_id=_competition_id AND role IN ('owner','admin')) $$;
CREATE FUNCTION public.accept_competition_role_link(p_token text) RETURNS text LANGUAGE sql AS $$ SELECT 'existing-link'::text $$;
CREATE TABLE before_definitions AS SELECT pg_get_functiondef('public.accept_competition_role_link(text)'::regprocedure) AS link,pg_get_triggerdef(oid) AS trigger FROM pg_trigger WHERE tgname='existing_role_sync';
""")
            cls.sql((ROOT/'docs/release-review/competition-functions-prod-candidate.sql').read_text())
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def command(cls, program, *args, input=None):
        result = subprocess.run([program, *args], input=input, text=True, capture_output=True, env=cls.env,
            timeout=45, **({'user':1000,'group':1000} if cls.root else {}))
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    @classmethod
    def sql(cls, text):
        return cls.command('psql','-XAtq','-h',str(cls.directory),'-p','55443','-U','rehearsal','-d','postgres','-v','ON_ERROR_STOP=1', input=text)

    @classmethod
    def tearDownClass(cls):
        if cls.started:
            cls.command('pg_ctl','-D',str(cls.directory/'db'),'-m','immediate','-w','stop')
        cls.tmp.cleanup()

    def setUp(self):
        self.sql(f"""
TRUNCATE public.competition_role_email_invites,public.notifications,public.competition_roles,public.trigger_log,public.user_roles,public.events,public.competition_matches,public.competitions,public.profiles,auth.users;
INSERT INTO auth.users VALUES('{OWNER}','owner@example.test',now()),('{INVITEE}','official@example.test',now()),('{OTHER}','wrong@example.test',now()),('{LEAGUE}','league@example.test',now());
INSERT INTO public.profiles SELECT id FROM auth.users;
INSERT INTO public.competitions VALUES('{COMP}','Competition','{CLUB}','active'),('{OTHER_COMP}','Other','50000000-0000-0000-0000-000000000001','active');
INSERT INTO public.competition_roles(competition_id,user_id,role) VALUES('{COMP}','{OWNER}','owner'),('{OTHER_COMP}','{OTHER}','owner');
INSERT INTO public.user_roles VALUES('{LEAGUE}','{CLUB}','league_admin');
INSERT INTO public.competition_matches VALUES('{MATCH}','{COMP}',0,NULL);
INSERT INTO public.events VALUES('{MATCH}','{MATCH}',0,NULL);
""")

    def caller(self, user, query, role='authenticated'):
        return self.sql(f"BEGIN; SET LOCAL ROLE {role}; SET LOCAL request.jwt.claim.sub='{user or ''}'; {query}; COMMIT;")

    def invite(self, role='referee', token=TOKEN):
        return self.caller(OWNER,f"SELECT public.create_competition_role_email_invite('{COMP}','{role}','{token}',' Official@Example.Test ','{HASH}')")

    def accept(self, user=INVITEE, token=TOKEN, proof=HASH):
        code = 'NULL' if proof is None else f"'{proof}'"
        return self.caller(user,f"SELECT status FROM public.accept_competition_role_email_invite('{token}',{code})")

    def test_owner_sees_exact_fixture(self):
        self.assertEqual(self.caller(OWNER,'SELECT match_id FROM public.get_my_viewable_competition_match_ids()'),MATCH)

    def test_scoped_league_admin_sees_fixture(self):
        self.assertEqual(self.caller(LEAGUE,'SELECT match_id FROM public.get_my_viewable_competition_match_ids()'),MATCH)

    def test_other_competition_owner_cannot_see_fixture(self):
        self.assertEqual(self.caller(OTHER,'SELECT count(*) FROM public.get_my_viewable_competition_match_ids()'),'0')

    def test_fixture_events_policy_is_scoped(self):
        self.assertEqual(self.caller(OWNER,'SELECT count(*) FROM public.events'),'1')
        self.assertEqual(self.caller(OTHER,'SELECT count(*) FROM public.events'),'0')

    def test_vault_preserves_manager_only_boundary(self):
        self.assertEqual(self.caller(OWNER,f"SELECT public.can_access_competition_vault('{COMP}')"),'t')
        self.assertEqual(self.caller(OTHER,f"SELECT public.can_access_competition_vault('{COMP}')"),'f')
        self.assertEqual(self.caller(LEAGUE,f"SELECT public.can_access_competition_vault('{COMP}')"),'f')

    def test_unknown_competition_fails_closed(self):
        self.assertEqual(self.caller(OWNER,"SELECT public.can_manage_competition_vault('90000000-0000-0000-0000-000000000001')"),'f')

    def test_no_anonymous_authorization(self):
        for signature in ['can_access_competition_vault(uuid)','get_my_viewable_competition_match_ids()','accept_competition_role_email_invite(text,text)']:
            self.assertEqual(self.sql(f"SELECT has_function_privilege('anon','public.{signature}','EXECUTE')"),'f')

    def test_invite_manager_select_only_and_service_grants(self):
        self.invite()
        self.assertEqual(self.caller(OWNER,'SELECT count(*) FROM public.competition_role_email_invites'),'1')
        self.assertEqual(self.caller(OTHER,'SELECT count(*) FROM public.competition_role_email_invites'),'0')
        self.assertEqual(self.sql("SELECT has_table_privilege('authenticated','public.competition_role_email_invites','INSERT')"),'f')
        self.assertEqual(self.sql("SELECT has_table_privilege('service_role','public.competition_role_email_invites','INSERT')"),'t')

    def test_unrelated_manager_cannot_create_invite(self):
        with self.assertRaisesRegex(AssertionError,'Competition admin required'):
            self.caller(OTHER,f"SELECT public.create_competition_role_email_invite('{COMP}','referee','{TOKEN}','official@example.test','{HASH}')")

    def test_null_proof_cannot_grant_role(self):
        self.invite()
        self.assertEqual(self.accept(proof=None),'code_invalid')
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.competition_roles WHERE user_id='{INVITEE}'"),'0')

    def test_wrong_email_cannot_claim_invite(self):
        self.invite()
        self.assertEqual(self.accept(OTHER),'code_invalid')

    def test_unverified_email_cannot_claim_invite(self):
        self.invite()
        self.sql(f"UPDATE auth.users SET email_confirmed_at=NULL WHERE id='{INVITEE}'")
        self.assertEqual(self.accept(),'email_unverified')

    def test_five_wrong_codes_lock_invite(self):
        self.invite()
        for attempt in range(5):
            self.assertEqual(self.accept(proof='c'*64),'locked' if attempt==4 else 'code_invalid')
        self.assertEqual(self.accept(),'invalid')

    def test_expiry_is_48_hours(self):
        self.invite()
        self.assertEqual(self.sql("SELECT expires_at-created_at=interval '48 hours' FROM public.competition_role_email_invites"),'t')
        self.sql("UPDATE public.competition_role_email_invites SET expires_at=now()-interval '1 second'")
        self.assertEqual(self.accept(),'invalid')

    def test_revoke_is_manager_scoped(self):
        self.invite()
        self.assertEqual(self.caller(OTHER,f"SELECT public.revoke_competition_role_email_invite('{TOKEN}')"),'f')
        self.assertEqual(self.caller(OWNER,f"SELECT public.revoke_competition_role_email_invite('{TOKEN}')"),'t')
        self.assertEqual(self.accept(),'invalid')

    def test_committee_role_maps_to_existing_vocabulary(self):
        self.invite('committee_member')
        self.assertEqual(self.accept(),'joined')
        self.assertEqual(self.sql(f"SELECT role FROM public.competition_roles WHERE user_id='{INVITEE}'"),'committee')

    def test_retry_grants_once_and_notifies_once(self):
        self.invite()
        self.assertEqual(self.accept(),'joined')
        self.assertEqual(self.accept(),'already')
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.notifications WHERE user_id='{INVITEE}'"),'1')
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.trigger_log WHERE user_id='{INVITEE}'"),'1')

    def test_parallel_tokens_do_not_duplicate_role_or_notification(self):
        from concurrent.futures import ThreadPoolExecutor
        self.invite(token=TOKEN)
        self.invite(token='d'*64)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda token:self.accept(token=token),[TOKEN,'d'*64]))
        self.assertEqual(sorted(results),['already','joined'])
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.notifications WHERE user_id='{INVITEE}'"),'1')

    def test_archived_competition_cannot_grant_role(self):
        self.invite()
        self.sql(f"UPDATE public.competitions SET status='archived' WHERE id='{COMP}'")
        self.assertEqual(self.accept(),'archived')

    def test_public_preview_reveals_no_email_or_code(self):
        self.invite()
        self.assertEqual(self.caller(None,f"SELECT status FROM public.get_competition_role_email_invite_status('{TOKEN}')",'anon'),'valid')
        self.assertEqual(self.caller(None,"SELECT status FROM public.get_competition_role_email_invite_status('missing')",'anon'),'invalid')
        self.assertEqual(self.sql("SELECT pg_get_function_result('public.get_competition_role_email_invite_status(text)'::regprocedure)"),'TABLE(status text, competition_id uuid, competition_name text, role text)')

    def test_parallel_same_token_is_single_use(self):
        from concurrent.futures import ThreadPoolExecutor
        self.invite()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:self.accept(),range(2)))
        self.assertEqual(sorted(results),['already','joined'])
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.notifications WHERE user_id='{INVITEE}'"),'1')

    def test_existing_role_acceptance_does_not_duplicate_effects(self):
        self.sql(f"INSERT INTO public.competition_roles(competition_id,user_id,role) VALUES('{COMP}','{INVITEE}','referee')")
        self.invite()
        self.assertEqual(self.accept(),'already')
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.notifications WHERE user_id='{INVITEE}'"),'0')
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.competition_roles WHERE user_id='{OWNER}' AND role='owner'"),'1')

    def test_creation_rejects_null_role_and_proof(self):
        for role,proof in [('NULL',f"'{HASH}'"),("'referee'",'NULL')]:
            with self.assertRaisesRegex(AssertionError,'Invalid'):
                self.caller(OWNER,f"SELECT public.create_competition_role_email_invite('{COMP}',{role},'{TOKEN}','official@example.test',{proof})")
        self.assertEqual(self.sql('SELECT count(*) FROM public.competition_role_email_invites'),'0')

    def test_existing_links_triggers_and_zero_null_scores_preserved(self):
        self.assertEqual(self.sql("SELECT link=pg_get_functiondef('public.accept_competition_role_link(text)'::regprocedure) AND trigger=(SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='existing_role_sync') FROM before_definitions"),'t')
        self.assertEqual(self.sql(f"SELECT home_score=0 AND away_score IS NULL FROM public.competition_matches WHERE id='{MATCH}'"),'t')
        self.assertEqual(self.sql(f"SELECT home_score=0 AND away_score IS NULL FROM public.events WHERE id='{MATCH}'"),'t')

if __name__=='__main__':
    unittest.main()