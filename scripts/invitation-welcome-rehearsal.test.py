"""Invitation defaults and welcome DM SQL integration, never a hosted E2E claim."""
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
ADMIN='10000000-0000-0000-0000-000000000001'
MEMBER='10000000-0000-0000-0000-000000000002'
OTHER='10000000-0000-0000-0000-000000000003'
SYSTEM='00000000-0000-0000-0000-000000000001'
CLUB='20000000-0000-0000-0000-000000000001'
SECOND='20000000-0000-0000-0000-000000000002'

class InvitationWelcome(unittest.TestCase):
    @classmethod
    def run_sql(cls,text):
        return cls.command('psql','-XAtq','-h',str(cls.directory),'-p','55444','-U','rehearsal','-d','postgres','-v','ON_ERROR_STOP=1',input=text)
    @classmethod
    def command(cls,program,*args,input=None):
        r=subprocess.run([program,*args],input=input,text=True,capture_output=True,env=cls.env,timeout=45,**({'user':1000,'group':1000} if cls.root else {}))
        if r.returncode: raise AssertionError(r.stderr)
        return r.stdout.strip()
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory(prefix='ignite-invite-welcome-');cls.directory=pathlib.Path(cls.tmp.name)
        cls.root=os.geteuid()==0
        if cls.root: os.chown(cls.directory,1000,1000)
        cls.env={'PATH':os.environ['PATH'],'HOME':str(cls.directory),'LANG':'C.UTF-8'};cls.started=False
        try:
            cls.command('initdb','-D',str(cls.directory/'db'),'-U','rehearsal','-A','trust','--no-locale')
            cls.command('pg_ctl','-D',str(cls.directory/'db'),'-l',str(cls.directory/'log'),'-o',f"-c listen_addresses='' -k {cls.directory} -p 55444",'-w','start');cls.started=True
            cls.run_sql("""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;
CREATE TABLE public.clubs(id uuid PRIMARY KEY);
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.user_roles(user_id uuid,club_id uuid,role text);
GRANT SELECT ON public.user_roles TO authenticated;
CREATE TABLE public.direct_conversations(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,participant_1 uuid REFERENCES public.profiles(id),participant_2 uuid REFERENCES public.profiles(id),created_by uuid,CONSTRAINT unique_participants UNIQUE(participant_1,participant_2),CHECK(participant_1<participant_2));
CREATE TABLE public.direct_messages(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,conversation_id uuid REFERENCES public.direct_conversations(id),author_id uuid,text text NOT NULL,is_system_message boolean);
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.direct_messages TO authenticated;
CREATE POLICY existing_participant_reads ON public.direct_messages FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.direct_conversations c WHERE c.id=conversation_id AND auth.uid() IN(c.participant_1,c.participant_2)));
GRANT SELECT ON public.direct_conversations TO authenticated;
""")
            cls.run_sql((ROOT/'supabase/migrations'/'20261105000300_club_invite_message_defaults.sql').read_text()
                        + (ROOT/'supabase/migrations'/'20261105000400_send_welcome_dm.sql').read_text())
        except BaseException: cls.tearDownClass();raise
    @classmethod
    def tearDownClass(cls):
        if cls.started: cls.command('pg_ctl','-D',str(cls.directory/'db'),'-m','immediate','-w','stop')
        cls.tmp.cleanup()
    def setUp(self):
        self.run_sql(f"TRUNCATE public.club_invite_message_defaults,public.direct_messages,public.direct_conversations,public.user_roles,public.clubs,public.profiles; INSERT INTO public.clubs VALUES('{CLUB}'),('{SECOND}'); INSERT INTO public.profiles VALUES('{SYSTEM}'),('{ADMIN}'),('{MEMBER}'),('{OTHER}'); INSERT INTO public.user_roles VALUES('{ADMIN}','{CLUB}','club_admin'),('{MEMBER}','{CLUB}','player'),('{OTHER}','{SECOND}','club_admin');")
    def caller(self,user,query):
        return self.run_sql(f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='{user or ''}'; {query}; COMMIT;")
    def save(self,message='Club invitation note'):
        return self.caller(ADMIN,f"INSERT INTO public.club_invite_message_defaults VALUES('{CLUB}','{message}') ON CONFLICT(club_id) DO UPDATE SET message=excluded.message")
    def welcome(self,user=MEMBER,message='Welcome from Ignite'):
        return self.caller(user,f"SELECT public.send_welcome_dm('{user}',{ 'NULL' if message is None else chr(39)+message+chr(39)})")
    def test_admin_upsert_and_member_readback(self):
        self.save();self.save('Updated note')
        self.assertEqual(self.caller(MEMBER,f"SELECT message FROM public.club_invite_message_defaults WHERE club_id='{CLUB}'"),'Updated note')
    def test_other_club_cannot_read_default(self):
        self.save();self.assertEqual(self.caller(OTHER,'SELECT count(*) FROM public.club_invite_message_defaults'),'0')
    def test_member_cannot_create_default(self):
        with self.assertRaisesRegex(AssertionError,'row-level security'):
            self.caller(MEMBER,f"INSERT INTO public.club_invite_message_defaults VALUES('{CLUB}','unauthorized')")
    def test_other_admin_cannot_change_default(self):
        self.save();self.caller(OTHER,f"UPDATE public.club_invite_message_defaults SET message='wrong' WHERE club_id='{CLUB}'")
        self.assertEqual(self.caller(MEMBER,'SELECT message FROM public.club_invite_message_defaults'),'Club invitation note')
    def test_anonymous_has_no_defaults_or_welcome_access(self):
        self.assertEqual(self.run_sql("SELECT has_table_privilege('anon','public.club_invite_message_defaults','SELECT')"),'f')
        self.assertEqual(self.run_sql("SELECT has_function_privilege('anon','public.send_welcome_dm(uuid,text)','EXECUTE')"),'f')
    def test_welcome_rejects_other_recipient(self):
        with self.assertRaisesRegex(AssertionError,'not authorized'):
            self.caller(OTHER,f"SELECT public.send_welcome_dm('{MEMBER}','wrong')")
    def test_null_or_signed_out_recipient_denied(self):
        for user,target in [(MEMBER,'NULL'),(None,f"'{MEMBER}'")]:
            with self.assertRaisesRegex(AssertionError,'not authorized'):
                self.caller(user,f"SELECT public.send_welcome_dm({target},NULL)")
    def test_welcome_recipient_reads_message_and_outsider_cannot(self):
        self.welcome()
        self.assertEqual(self.caller(MEMBER,'SELECT text FROM public.direct_messages'),'Welcome from Ignite')
        self.assertEqual(self.caller(OTHER,'SELECT count(*) FROM public.direct_messages'),'0')
    def test_concurrent_profile_completion_sends_once(self):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda _:self.welcome(),range(2)))
        self.assertEqual(results[0],results[1]);self.assertEqual(self.run_sql('SELECT count(*) FROM public.direct_messages'),'1')
    def test_retry_does_not_replace_message(self):
        first=self.welcome();self.assertEqual(self.welcome(message='changed'),first)
        self.assertEqual(self.caller(MEMBER,'SELECT text FROM public.direct_messages'),'Welcome from Ignite')
    def test_missing_sender_creates_no_orphan_conversation(self):
        self.run_sql(f"DELETE FROM public.profiles WHERE id='{SYSTEM}'")
        self.assertEqual(self.welcome(),'');self.assertEqual(self.run_sql('SELECT count(*) FROM public.direct_conversations'),'0')
    def test_text_limit_and_blank_fallback(self):
        self.welcome(message='x'*4001);self.assertEqual(self.run_sql('SELECT length(text) FROM public.direct_messages'),'4000')
        self.run_sql('TRUNCATE public.direct_messages')
        self.welcome(message='  ');self.assertTrue(self.run_sql('SELECT text FROM public.direct_messages').startswith('Welcome to Ignite!'))

if __name__=='__main__':unittest.main()