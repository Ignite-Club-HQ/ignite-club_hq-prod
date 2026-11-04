import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
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