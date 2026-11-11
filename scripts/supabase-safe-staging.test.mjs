import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planSafeStaging, readSafeInputs, SAFE_TARGET } from './supabase-safe-staging.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const a = '20261104000000_safe.sql';
const b = '20261104000001_unsafe.sql';
const files = { [a]: 'ALTER TABLE public.clubs ADD COLUMN country text;', [b]: 'DELETE FROM public.clubs;' };
const manifest = { schemaVersion: 1, projectRef: SAFE_TARGET, mode: 'review-only', deploymentAuthorized: false,
  sources: Object.entries(files).map(([file, sql], index) => ({ file, sha256: digest(sql), disposition: index ? 'hold' : 'candidate', reason: 'reviewed scope' })) };
const policy = { migrations: [{ file: b, sha256: digest(files[b]), prodStatus: 'blocked' }] };
const clone = () => structuredClone(manifest);

test('safe staging separates candidates without executing held originals or granting deployment', () => {
  const report = planSafeStaging(manifest, files, policy, []);
  assert.deepEqual(report.candidates.map(entry => entry.file), [a]);
  assert.deepEqual(report.held.map(entry => entry.file), [b]);
  assert.equal(report.sourceInventory.length, 2);
  assert.equal(report.deploymentAuthorized, false);
  assert.equal(report.historyWrites, false);
  assert.equal(report.issues.length, 1);
});
test('added missing reordered and modified originals fail closed', () => {
  assert.throws(() => planSafeStaging(manifest, { ...files, '20261104000002_extra.sql': 'SELECT 1' }, policy, []));
  assert.throws(() => planSafeStaging(manifest, { [a]: files[a] }, policy, []));
  const reordered = clone(); reordered.sources.reverse();
  assert.throws(() => planSafeStaging(reordered, files, policy, []));
  assert.throws(() => planSafeStaging(manifest, { ...files, [a]: files[a] + ' DELETE FROM public.clubs;' }, policy, []));
});
test('protected blocked sources cannot be selected even with matching fingerprints', () => {
  const altered = clone(); altered.sources[1].disposition = 'candidate';
  assert.throws(() => planSafeStaging(altered, files, policy, []), /Blocked original/);
  assert.throws(() => planSafeStaging(manifest, files, { migrations: [{ ...policy.migrations[0], sha256: '0'.repeat(64) }] }, []), /Protected original/);
});
test('wrong target and self-authorized manifest are rejected', () => {
  assert.throws(() => planSafeStaging({ ...manifest, projectRef: 'ecsdwrarzfexssxtrymj' }, files, policy, []));
  assert.throws(() => planSafeStaging({ ...manifest, deploymentAuthorized: true }, files, policy, []));
});
test('only real read-back versions suppress candidates; no history repair is inferred', () => {
  assert.equal(planSafeStaging(manifest, files, policy, [{ version: a.split('_')[0] }]).candidates.length, 0);
  assert.throws(() => planSafeStaging(manifest, files, policy, [{ version: 'bad' }]));
  assert.throws(() => planSafeStaging(manifest, files, policy, [{ version: a.split('_')[0] }, { version: a.split('_')[0] }]));
});
test('source directory symlinks are rejected', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'safe-staging-'));
  try {
    mkdirSync(path.join(root, 'supabase')); mkdirSync(path.join(root, 'actual'));
    writeFileSync(path.join(root, 'actual', a), files[a]);
    symlinkSync(path.join(root, 'actual'), path.join(root, 'supabase/migrations'));
    assert.throws(() => readSafeInputs(root), /regular files/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('repository manifest accounts for every original and keeps privacy and activation work held', () => {
  const root = new URL('../', import.meta.url).pathname;
  const input = readSafeInputs(root);
  const report = planSafeStaging(input.manifest, input.files, { migrations: [] }, []);
  assert.equal(report.sourceInventory.length, Object.keys(input.files).length);
  for (const version of ['20261021003048', '20261021003143', '20261030052009', '20261008014417', '20261012000000', '20261012010000']) {
    assert.equal(report.sourceInventory.find(entry => entry.file.startsWith(version))?.disposition, 'hold');
  }
});
test('workflow runner safe-plan stops before every write and records a held phase', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'safe-runner-'));
  try {
    const log = path.join(temp, 'commands');
    writeFileSync(path.join(temp, 'psql'), '#!/bin/sh\nprintf "psql %s\\n" "$PGOPTIONS" >> "$SAFE_TEST_LOG"\nprintf "[]"\n', { mode: 0o755 });
    writeFileSync(path.join(temp, 'supabase'), '#!/bin/sh\nprintf "FORBIDDEN WRITE\\n" >> "$SAFE_TEST_LOG"\nexit 88\n', { mode: 0o755 });
    const result = spawnSync(process.execPath, ['scripts/supabase-structural-release.mjs'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${temp}:${process.env.PATH}`,
        SAFE_TEST_LOG: log, GITHUB_REF: 'refs/heads/prod', PROJECT_REF: SAFE_TARGET,
        SUPABASE_ACCESS_TOKEN: 'fixture-only', SUPABASE_DB_PASSWORD: 'fixture-only',
        GITHUB_SHA: 'a'.repeat(40), RELEASE_MODE: 'safe-plan', RELEASE_REPORT_DIR: temp },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(path.join(temp, 'release-report.json'), 'utf8'));
    assert.equal(report.phase, 'safe-plan-held');
    assert.equal(report.deploymentAuthorized, false);
    assert.deepEqual(report.functions, []);
    assert.equal(report.candidates.length, 16);
    assert.equal(report.held.length, 39);
    const approved = JSON.parse(readFileSync('docs/release-review/safe-apply-approval.json', 'utf8')).migrations.map(m => m.file);
    assert.deepEqual(approved.slice().sort(), report.candidates.map(c => c.file).filter(f => approved.includes(f)).sort());
    const commands = readFileSync(log, 'utf8');
    assert.match(commands, /default_transaction_read_only=on/);
    assert.doesNotMatch(commands, /FORBIDDEN WRITE/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});