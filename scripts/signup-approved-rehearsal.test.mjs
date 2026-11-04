import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

test('exact approved signup migration preserves existing accounts and profile creation', () => {
  const approval = JSON.parse(readFileSync('docs/release-review/safe-apply-approval.json', 'utf8'));
  assert.equal(approval.migrations.length, 1);
  const approved = approval.migrations[0];
  const source = readFileSync(`supabase/migrations/${approved.file}`, 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), approved.sha256);
  const directory = mkdtempSync(path.join(tmpdir(), 'ignite-approved-signup-'));
  const env = { PATH: process.env.PATH, HOME: directory, LANG: 'C.UTF-8' };
  const root = process.getuid?.() === 0;
  const command = (program, args) => {
    const result = spawnSync(program, args, { env, encoding: 'utf8', timeout: 60000,
      ...(root ? { uid: 1000, gid: 1000 } : {}) });
    assert.equal(result.status, 0, `${program}: ${result.stderr}`);
    return result.stdout;
  };
  let started = false;
  try {
    const assertions = `
      DO $$ DECLARE rejected boolean := false; BEGIN
        BEGIN
          INSERT INTO auth.users VALUES (gen_random_uuid(), 'uninvited@example.test', '{"provider":"email"}', '{}');
        EXCEPTION WHEN SQLSTATE 'P0001' THEN rejected := true; END;
        IF NOT rejected THEN RAISE EXCEPTION 'Armed guard allowed uninvited signup'; END IF;
        UPDATE auth.users SET raw_user_meta_data='{"updated":true}' WHERE id='10000000-0000-0000-0000-000000000001';
        IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id='10000000-0000-0000-0000-000000000001' AND raw_user_meta_data='{"updated":true}') THEN RAISE EXCEPTION 'Existing account update failed'; END IF;
        INSERT INTO auth.users VALUES (gen_random_uuid(), 'invited@example.test', '{"provider":"email"}', '{"email_signup_invite_token":"team-one"}');
        INSERT INTO auth.users VALUES (gen_random_uuid(), 'google@example.test', '{"provider":"google"}', '{}');
      END $$;
      UPDATE public.app_settings SET value='{"emailAuthClubs":[]}' WHERE key='backend_routing_config';
      INSERT INTO auth.users VALUES (gen_random_uuid(), 'empty@example.test', '{"provider":"email"}', '{}');
      DELETE FROM public.app_settings WHERE key='backend_routing_config';
      INSERT INTO auth.users VALUES (gen_random_uuid(), 'absent@example.test', '{"provider":"email"}', '{}');
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM original_definitions WHERE profile <> pg_get_functiondef('public.handle_new_user()'::regprocedure)
          OR profile_trigger <> (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='on_auth_user_created')
          OR claims_trigger <> (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='trg_auto_claim_eois')) THEN RAISE EXCEPTION 'Existing lifecycle changed'; END IF;
        IF (SELECT count(*) FROM auth.users) <> 5 OR (SELECT count(*) FROM public.profiles) <> 5 OR (SELECT count(*) FROM public.claim_audit) <> 5 THEN RAISE EXCEPTION 'Account/profile/claim counts differ'; END IF;
        IF has_function_privilege('authenticated','public.email_signup_invite_allowed(text,text)','EXECUTE') OR has_function_privilege('anon','public.email_signup_invite_allowed(text,text)','EXECUTE') THEN RAISE EXCEPTION 'Guard helper exposed'; END IF;
      END $$;
      SELECT 'PASS: exact approved migration compatibility';`;
    const fixture = readFileSync('scripts/signup-rehearsal-fixture.sql', 'utf8');
    // Existing account is created before installing the new guard.
    const preexisting = "INSERT INTO auth.users VALUES ('10000000-0000-0000-0000-000000000001', 'existing@example.test', '{\"provider\":\"email\"}', '{}');";
    writeFileSync(path.join(directory, 'rehearsal.sql'), fixture + '\n' + preexisting + '\n' + source + '\n' + assertions);
    if (root) assert.equal(spawnSync('chown', ['-R', 'lovable', directory], { env }).status, 0);
    command('initdb', ['-D', path.join(directory, 'data'), '-A', 'trust', '-U', 'rehearsal', '--no-locale']);
    command('pg_ctl', ['-D', path.join(directory, 'data'), '-l', path.join(directory, 'server.log'), '-o', `-c listen_addresses='' -k ${directory} -p 55440`, '-w', 'start']);
    started = true;
    assert.match(command('psql', ['-X', '-h', directory, '-p', '55440', '-U', 'rehearsal', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', path.join(directory, 'rehearsal.sql')]), /PASS: exact approved migration compatibility/);
  } finally {
    if (started) command('pg_ctl', ['-D', path.join(directory, 'data'), '-m', 'immediate', '-w', 'stop']);
    rmSync(directory, { recursive: true, force: true });
  }
});