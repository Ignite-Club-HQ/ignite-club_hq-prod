"""Rehearse the exact missing-action repair without hosted credentials or data."""
import importlib.util
import os
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('competition_contracts', ROOT/'scripts/competition-functions-rehearsal.test.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
SELF = base.INVITEE
COMP = base.COMP
OWNER = base.OWNER
ROW = '60000000-0000-0000-0000-000000000001'

class RoleRemoval(unittest.TestCase):
    command = classmethod(base.CompetitionContracts.command.__func__)
    sql = classmethod(base.CompetitionContracts.sql.__func__)
    tearDownClass = classmethod(base.CompetitionContracts.tearDownClass.__func__)
    caller = base.CompetitionContracts.caller

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='ignite-role-removal-')
        cls.directory = pathlib.Path(cls.tmp.name)
        cls.root = os.geteuid() == 0
        if cls.root:
            os.chown(cls.directory, 1000, 1000)
        cls.env = {'PATH': os.environ['PATH'], 'HOME': str(cls.directory), 'LANG': 'C.UTF-8'}
        cls.started = False
        cls.command('initdb', '-D', str(cls.directory/'db'), '-U', 'rehearsal', '-A', 'trust', '--no-locale')
        cls.command('pg_ctl', '-D', str(cls.directory/'db'), '-l', str(cls.directory/'log'), '-o', f"-c listen_addresses='' -k {cls.directory} -p 55443", '-w', 'start')
        cls.started = True
        cls.sql("""
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
CREATE TABLE public.competitions(id uuid PRIMARY KEY);
GRANT SELECT ON public.competitions TO authenticated;
CREATE TABLE public.competition_roles(id uuid PRIMARY KEY,competition_id uuid,user_id uuid,role text);
GRANT SELECT,DELETE ON public.competition_roles TO authenticated;
ALTER TABLE public.competition_roles ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.user_roles(user_id uuid,role text);
GRANT SELECT ON public.user_roles TO authenticated;
CREATE FUNCTION public.is_competition_admin(u uuid,c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.competition_roles WHERE user_id=u AND competition_id=c AND role IN ('owner','admin')) $$;
CREATE POLICY manage ON public.competition_roles TO authenticated USING(public.is_competition_admin(auth.uid(),competition_id));
""")
        candidate = (ROOT/'docs/release-review/competition-role-removal-compatibility.sql').read_text()
        # Reproduce absence, then prove the same contract is installed by repair.
        assert cls.sql("SELECT to_regprocedure('public.remove_exact_competition_role(uuid,uuid,uuid,text)') IS NULL") == 't'
        cls.sql(candidate)
        cls.sql(candidate)  # Compatible with TEST where policies/trigger already exist.

    def setUp(self):
        self.sql(f"""TRUNCATE public.competition_roles,public.competitions,public.user_roles;
INSERT INTO public.competitions VALUES('{COMP}'),('{base.OTHER_COMP}');
INSERT INTO public.competition_roles VALUES
('{ROW}','{COMP}','{SELF}','admin'),
('60000000-0000-0000-0000-000000000002','{COMP}','{SELF}','referee'),
('60000000-0000-0000-0000-000000000003','{COMP}','{OWNER}','owner'),
('60000000-0000-0000-0000-000000000004','{base.OTHER_COMP}','{SELF}','admin');
INSERT INTO public.user_roles VALUES('{SELF}','club_admin');""")

    def remove(self, caller=SELF, row=ROW, person=SELF, role='admin', comp=COMP):
        return self.caller(caller, f"SELECT public.remove_exact_competition_role('{row}','{comp}','{person}','{role}')")

    def test_exact_self_role_only(self):
        self.assertEqual(self.remove(), 't')
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.competition_roles WHERE id='{ROW}'"), '0')
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.competition_roles WHERE user_id='{SELF}'"), '2')
        self.assertEqual(self.sql(f"SELECT role FROM public.user_roles WHERE user_id='{SELF}'"), 'club_admin')

    def test_owner_cannot_leave(self):
        with self.assertRaisesRegex(AssertionError, 'Owner roles cannot be removed'):
            self.remove(OWNER, '60000000-0000-0000-0000-000000000003', OWNER, 'owner')
        self.assertEqual(self.sql("SELECT count(*) FROM public.competition_roles WHERE role='owner'"), '1')

    def test_other_person_without_authority_denied(self):
        with self.assertRaises(AssertionError):
            self.remove(base.OTHER)
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.competition_roles WHERE id='{ROW}'"), '1')

    def test_wrong_competition_denied(self):
        with self.assertRaises(AssertionError):
            self.remove(comp=base.OTHER_COMP)
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.competition_roles WHERE id='{ROW}'"), '1')

    def test_anonymous_cannot_execute(self):
        self.assertEqual(self.sql("SELECT has_function_privilege('anon','public.remove_exact_competition_role(uuid,uuid,uuid,text)','EXECUTE')"), 'f')

    def test_manager_can_remove_exact_other_non_owner_role(self):
        self.assertEqual(self.remove(OWNER), 't')
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.competition_roles WHERE user_id='{SELF}'"), '2')

if __name__ == '__main__':
    unittest.main()