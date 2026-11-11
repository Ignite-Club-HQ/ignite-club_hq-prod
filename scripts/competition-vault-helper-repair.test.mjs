import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('exact absent-only repair preserves existing helpers and enforces competition host scope', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'vault-helper-repair-'));
  const env = { PATH: process.env.PATH, HOME: directory, LANG: 'C.UTF-8' };
  const root = process.getuid?.() === 0;
  const command = (program, args) => {
    const result = spawnSync(program, args, { env, encoding: 'utf8', timeout: 60000,
      ...(root ? { uid: 1000, gid: 1000 } : {}) });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  let started = false;
  try {
    if (root) assert.equal(spawnSync('chown', ['-R', 'lovable', directory], { env }).status, 0);
    command('initdb', ['-D', path.join(directory, 'data'), '-A', 'trust', '-U', 'rehearsal', '--no-locale']);
    command('pg_ctl', ['-D', path.join(directory, 'data'), '-l', path.join(directory, 'log'), '-o', `-c listen_addresses='' -k ${directory} -p 55446`, '-w', 'start']);
    started = true;
    const args = ['-XAt', '-h', directory, '-p', '55446', '-U', 'rehearsal', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
    const query = sql => command('psql', [...args, '-c', sql]).trim();
    query(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.competitions(id uuid, organizer_club_id uuid);
      INSERT INTO public.competitions VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE FUNCTION public.can_manage_competition_vault(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.manager',true)='yes' $$;
      CREATE FUNCTION public.can_access_competition_vault(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.reader',true)='yes' $$;`);
    const original = query("SELECT pg_get_functiondef('public.can_manage_competition_vault(uuid)'::regprocedure)");
    assert.equal(query("SELECT to_regprocedure('public.competition_vault_storage_access(text,boolean)') IS NULL"), 't');
    const source = readFileSync('supabase/migrations/20261111093535_7883a092-68d3-41a9-8f69-dd5119c108c6.sql', 'utf8');
    query(source);
    assert.equal(query("SELECT to_regprocedure('public.competition_vault_storage_access(text,boolean)') IS NOT NULL"), 't');
    const object = 'clubs/10000000-0000-0000-0000-000000000001/competitions/20000000-0000-0000-0000-000000000001/user/file.pdf';
    assert.equal(query(`SELECT public.competition_vault_storage_access('${object}',true)`), 'f', 'signed-out must fail');
    const settings = "SET test.uid='30000000-0000-0000-0000-000000000001'; SET test.manager='yes'; SET test.reader='no';";
    const answer = sql => query(settings + sql).split('\n').at(-1);
    assert.equal(answer(`SELECT public.competition_vault_storage_access('${object}',true)`), 't');
    assert.equal(answer(`SELECT public.competition_vault_storage_access('${object}',false)`), 'f');
    assert.equal(answer(`SELECT public.competition_vault_storage_access('${object.replace('10000000','99999999')}',true)`), 'f');
    assert.equal(answer("SELECT public.competition_vault_storage_access('clubs/bad/competitions/bad/file',true)"), 'f');
    assert.equal(answer(`SELECT public.competition_vault_storage_access('${object}',NULL)`), 'f');
    assert.equal(query("SELECT has_function_privilege('anon','public.competition_vault_storage_access(text,boolean)','EXECUTE')"), 'f');
    assert.equal(query("SELECT has_function_privilege('authenticated','public.competition_vault_storage_access(text,boolean)','EXECUTE')"), 't');
    const repaired = query("SELECT pg_get_functiondef('public.competition_vault_storage_access(text,boolean)'::regprocedure)");
    query(source);
    assert.equal(query("SELECT pg_get_functiondef('public.competition_vault_storage_access(text,boolean)'::regprocedure)"), repaired);
    assert.equal(query("SELECT pg_get_functiondef('public.can_manage_competition_vault(uuid)'::regprocedure)"), original);
    assert.equal(query('SELECT count(*) FROM public.competitions'), '1');
  } finally {
    if (started) command('pg_ctl', ['-D', path.join(directory, 'data'), '-m', 'immediate', '-w', 'stop']);
    rmSync(directory, { recursive: true, force: true });
  }
});