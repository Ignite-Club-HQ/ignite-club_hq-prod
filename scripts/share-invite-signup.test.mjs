import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('share-token signup and atomic parent acceptance preserve exact invitation scope', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ignite-share-invite-'));
  const root = process.getuid?.() === 0;
  const run = (program, args) => {
    const r = spawnSync(program, args, { encoding: 'utf8', timeout: 60000,
      ...(root ? { uid: 1000, gid: 1000 } : {}) });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const fixture = `
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'authenticated'::text$$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
CREATE TABLE profiles(id uuid PRIMARY KEY);
CREATE TYPE app_role AS ENUM ('parent','guardian');
CREATE TABLE app_settings(key text,value jsonb);
CREATE TABLE teams(id uuid PRIMARY KEY,club_id uuid);
CREATE TABLE pending_invites(id uuid PRIMARY KEY,invite_token text,status text,invited_user_id uuid,invited_email text,team_id uuid,club_id uuid,role app_role,metadata jsonb,accepted_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE team_invites(token text,team_id uuid,expires_at timestamptz,max_uses int,uses_count int);
CREATE TABLE club_invites(token text,club_id uuid,expires_at timestamptz,max_uses int,uses_count int);
CREATE TABLE children(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),parent_id uuid,name text,year_of_birth int,created_at timestamptz DEFAULT now());
CREATE TABLE child_guardians(child_id uuid,guardian_id uuid,relationship_type text,is_primary boolean,UNIQUE(child_id,guardian_id));
CREATE TABLE child_team_assignments(child_id uuid,team_id uuid,UNIQUE(child_id,team_id));
CREATE TABLE child_mini_league_assignments(child_id uuid,mini_league_id uuid,ability_rating int);
CREATE TABLE mini_leagues(id uuid,club_id uuid);
CREATE TABLE mini_league_players(id uuid,parent_user_id uuid,child_id uuid,mini_league_id uuid);
CREATE TABLE user_roles(user_id uuid,role app_role,team_id uuid,club_id uuid);
INSERT INTO app_settings VALUES ('backend_routing_config','{"emailAuthClubs":[{"id":"00000000-0000-0000-0000-000000000001"}]}');
INSERT INTO teams VALUES ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001');
INSERT INTO pending_invites(id,invite_token,status,invited_email,team_id,club_id,role,metadata)
SELECT gen_random_uuid(),token,'pending',email,'00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','parent',jsonb_build_object('children',jsonb_build_array(jsonb_build_object('name',token,'yearOfBirth',2016)))
FROM (VALUES ('share',NULL::text),('blank','  '),('named','Bound@Example.com'),('unrelated','arbitrary@example.com'),('outside',NULL),('used',NULL),('expired',NULL),('claimed',NULL)) v(token,email);
UPDATE pending_invites SET club_id='00000000-0000-0000-0000-000000000002',team_id=NULL WHERE invite_token='outside';
UPDATE pending_invites SET status='accepted' WHERE invite_token='used';
UPDATE pending_invites SET status='expired' WHERE invite_token='expired';
UPDATE pending_invites SET invited_user_id=gen_random_uuid() WHERE invite_token='claimed';
`;
  const assertions = `
CREATE TRIGGER signup_guard BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION enforce_email_signup_invite();
CREATE FUNCTION create_profile() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO profiles VALUES(NEW.id); RETURN NEW; END$$;
CREATE TRIGGER create_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION create_profile();
CREATE TRIGGER claim_profile AFTER INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION claim_pending_invites_on_profile_create();
CREATE TRIGGER claim_role AFTER INSERT ON user_roles FOR EACH ROW EXECUTE FUNCTION auto_accept_pending_invites_on_role();
DO $$DECLARE token text; uid uuid := '10000000-0000-0000-0000-000000000001'; inv uuid; result jsonb; BEGIN
 IF email_signup_invite_allowed('share','arbitrary@example.com') IS DISTINCT FROM true THEN RAISE EXCEPTION 'share denied'; END IF;
 IF email_signup_invite_allowed('blank','arbitrary@example.com') IS DISTINCT FROM true THEN RAISE EXCEPTION 'blank denied'; END IF;
 IF email_signup_invite_allowed('named','bound@example.com') IS DISTINCT FROM true THEN RAISE EXCEPTION 'bound email denied'; END IF;
 IF email_signup_invite_allowed('named','different@example.com') IS DISTINCT FROM false THEN RAISE EXCEPTION 'wrong email allowed'; END IF;
 FOREACH token IN ARRAY ARRAY['outside','used','expired','claimed'] LOOP
  IF email_signup_invite_allowed(token,'arbitrary@example.com') IS DISTINCT FROM false THEN RAISE EXCEPTION 'invalid token allowed: %',token; END IF;
 END LOOP;
 INSERT INTO auth.users VALUES(uid,'arbitrary@example.com','{"provider":"email"}','{"email_signup_invite_token":"share"}');
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=uid) THEN RAISE EXCEPTION 'profile missing'; END IF;
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 SELECT id INTO inv FROM pending_invites WHERE invite_token='share';
 BEGIN PERFORM accept_parent_team_invite(inv,NULL); RAISE EXCEPTION 'public ID granted bearer access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result := accept_parent_team_invite(NULL,'share');
 IF jsonb_array_length(result->'child_ids')<>1 THEN RAISE EXCEPTION 'child missing'; END IF;
 IF (SELECT count(*) FROM children WHERE parent_id=uid)<>1 THEN RAISE EXCEPTION 'child count wrong'; END IF;
 IF (SELECT count(*) FROM user_roles WHERE user_id=uid AND role='parent')<>1 THEN RAISE EXCEPTION 'parent role missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pending_invites WHERE invite_token='share' AND status='accepted' AND invited_user_id=uid) THEN RAISE EXCEPTION 'invite not accepted'; END IF;
 result := accept_parent_team_invite(NULL,'share');
 IF result->>'already_accepted'<>'true' OR (SELECT count(*) FROM children WHERE parent_id=uid)<>1 OR (SELECT count(*) FROM user_roles WHERE user_id=uid)<>1 THEN RAISE EXCEPTION 'retry duplicated membership'; END IF;
 IF EXISTS(SELECT 1 FROM pending_invites WHERE invite_token='unrelated' AND (status<>'pending' OR invited_user_id IS NOT NULL)) THEN RAISE EXCEPTION 'unrelated invite claimed'; END IF;
 INSERT INTO auth.users VALUES(gen_random_uuid(),NULL,'{"provider":"internet_identity"}','{}');
 IF (SELECT count(*) FROM auth.users)<>2 THEN RAISE EXCEPTION 'II signup affected'; END IF;
END$$;
SELECT 'PASS share signup, email binding, disabled club, used/expired, II, retry and isolation';`;
  let started=false;
  try {
    writeFileSync(path.join(dir,'check.sql'),fixture+'\n'+readFileSync('scripts/fixtures/share-invite-reviewed-functions.sql','utf8')+'\n'+assertions);
    if(root) assert.equal(spawnSync('chown',['-R','lovable',dir]).status,0);
    run('initdb',['-D',path.join(dir,'data'),'-A','trust','-U','rehearsal','--no-locale']);
    run('pg_ctl',['-D',path.join(dir,'data'),'-l',path.join(dir,'server.log'),'-o',`-c listen_addresses='' -k ${dir} -p 55442`,'-w','start']); started=true;
    assert.match(run('psql',['-X','-h',dir,'-p','55442','-U','rehearsal','-d','postgres','-v','ON_ERROR_STOP=1','-f',path.join(dir,'check.sql')]),/PASS share signup/);
  } finally {
    if(started) run('pg_ctl',['-D',path.join(dir,'data'),'-m','immediate','-w','stop']);
    rmSync(dir,{recursive:true,force:true});
  }
});