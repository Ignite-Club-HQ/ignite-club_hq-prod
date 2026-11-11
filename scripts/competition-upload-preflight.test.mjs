import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { COMPETITION_UPLOAD_FILE as file, competitionUploadDependencies as dependencies,
  competitionUploadPreflightSql, readCompetitionUploadPreflight } from './supabase-structural-release.mjs';

const files = { [file]: readFileSync(`supabase/migrations/${file}`, 'utf8') };
const sql = competitionUploadPreflightSql(files, [{ file }]);
const present = () => dependencies.map((_, id) => ({ id, exists: true }));

test('preflight is source-bound and only runs for pending competition upload', () => {
  assert.equal(competitionUploadPreflightSql(files, []), null);
  assert.throws(() => competitionUploadPreflightSql({ [file]: files[file] + '\n' }, [{ file }]), /source changed/);
});
test('missing dependencies have exact fixed names, including the function signature', () => {
  for (let i = 0; i < dependencies.length; i++) {
    const rows = present(); rows[i].exists = false;
    assert.deepEqual(readCompetitionUploadPreflight(JSON.stringify(rows)), [dependencies[i].object]);
  }
  assert.deepEqual(readCompetitionUploadPreflight(JSON.stringify(present())), []);
});
test('partial, duplicated, malformed or injected evidence fails closed without echoing it', () => {
  for (const value of ['private-diagnostic', '[]', JSON.stringify([...present(), { id: 9, exists: true }]),
    JSON.stringify(present().map(row => ({ ...row, id: 0 }))),
    JSON.stringify(present().map(row => ({ ...row, exists: 'true' }))),
    JSON.stringify(present().map(row => ({ ...row, secret: 'private-diagnostic' })))]) {
    assert.throws(() => readCompetitionUploadPreflight(value), error =>
      /preflight.*(unreadable|incomplete)/.test(error.message) && !error.message.includes('private-diagnostic'));
  }
});

test('real release stops before every write and persists exact missing object evidence', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'competition-preflight-runner-'));
  try {
    const rows = present();
    rows[dependencies.findIndex(d => d.object === 'public.competition_vault_storage_access(text,boolean)')].exists = false;
    writeFileSync(path.join(directory, 'psql'), `#!/bin/sh
case "$PGOPTIONS" in
  *default_transaction_read_only=on*) ;;
  *) touch "$RELEASE_REPORT_DIR/unexpected-write"; exit 1;;
esac
for a in "$@"; do
  case "$a" in *competition-upload-dependency-preflight*) printf '%s' '${JSON.stringify(rows)}'; exit 0;; esac
done
printf '[]'
`, { mode: 0o700 });
    const result = spawnSync(process.execPath, ['scripts/supabase-structural-release.mjs'], {
      encoding: 'utf8', env: { PATH: `${directory}:${process.env.PATH}`, HOME: directory,
        GITHUB_REF: 'refs/heads/prod', PROJECT_REF: 'yabcfiuntwqjwvschnji',
        SUPABASE_ACCESS_TOKEN: 'fixture', SUPABASE_DB_PASSWORD: 'fixture', GITHUB_SHA: 'a'.repeat(40),
        RELEASE_REPORT_DIR: directory, RELEASE_MODE: 'safe-apply' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing database objects: public\.competition_vault_storage_access\(text,boolean\)/);
    assert.equal(existsSync(path.join(directory, 'unexpected-write')), false);
    const report = JSON.parse(readFileSync(path.join(directory, 'release-report.json'), 'utf8'));
    assert.equal(report.phase, 'dependency-preflight-held');
    assert.equal(report.applied, undefined);
    assert.deepEqual(report.competitionUploadPreflight.missing, ['public.competition_vault_storage_access(text,boolean)']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('catalog SQL works on a credential-free socket-only PostgreSQL and never invokes helpers', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'competition-preflight-db-'));
  const env = { PATH: process.env.PATH, HOME: directory, LANG: 'C.UTF-8' };
  const root = process.getuid?.() === 0;
  const command = (program, args, extra = {}) => {
    const result = spawnSync(program, args, { env, encoding: 'utf8', timeout: 60000,
      ...(root ? { uid: 1000, gid: 1000 } : {}), ...extra });
    assert.equal(result.status, 0, `${program}: ${result.stderr}`);
    return result.stdout;
  };
  let started = false;
  try {
    if (root) assert.equal(spawnSync('chown', ['-R', 'lovable', directory], { env }).status, 0);
    command('initdb', ['-D', path.join(directory, 'data'), '-A', 'trust', '-U', 'rehearsal', '--no-locale']);
    command('pg_ctl', ['-D', path.join(directory, 'data'), '-l', path.join(directory, 'log'), '-o', `-c listen_addresses='' -k ${directory} -p 55445`, '-w', 'start']);
    started = true;
    const args = ['-XAt', '-h', directory, '-p', '55445', '-U', 'rehearsal', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
    const read = () => readCompetitionUploadPreflight(command('psql', [...args, '-c', sql], {
      env: { ...env, PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=10000' },
    }));
    assert.ok(read().includes('storage.objects'));
    command('psql', [...args, '-c', `CREATE SCHEMA storage; CREATE SCHEMA auth;
      CREATE TABLE storage.objects (name text, bucket_id text);
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'must not execute'; END $$;
      CREATE FUNCTION public.competition_vault_storage_access(text,boolean) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'must not execute'; END $$;`]);
    assert.deepEqual(read(), []);
    command('psql', [...args, '-c', 'DROP FUNCTION public.competition_vault_storage_access(text,boolean); ALTER TABLE storage.objects DROP COLUMN bucket_id;']);
    assert.deepEqual(read(), ['storage.objects.bucket_id', 'public.competition_vault_storage_access(text,boolean)']);
  } finally {
    if (started) command('pg_ctl', ['-D', path.join(directory, 'data'), '-m', 'immediate', '-w', 'stop']);
    rmSync(directory, { recursive: true, force: true });
  }
});