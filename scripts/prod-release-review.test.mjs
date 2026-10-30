import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildProdReleaseReview, buildProdTransitionReview, sha256 } from './prod-release-review.mjs';

const evidence = {
  projectRef: 'yabcfiuntwqjwvschnji',
  origin: 'owner-supplied-sql-editor-export',
  sourceSha256: sha256('owner evidence'),
  appliedVersions: ['20261029094707'],
};
const older = '20260928122526_older.sql';
const policy = { migrations: [] };

test('older pending files remain held despite a newer applied date', () => {
  const result = buildProdReleaseReview(evidence, { [older]: 'select 1;' }, policy);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.migrations[0].file, older);
  assert.equal(result.migrations[0].releaseStatus, 'hold');
});
test('owner evidence never grants deployment or independently verifies connection identity', () => {
  const result = buildProdReleaseReview(evidence, {}, policy);
  assert.equal(result.deploymentAuthorized, false);
  assert.equal(result.independentlyVerifiedConnection, false);
});
test('DEV evidence and missing fingerprints cannot substitute for PROD review', () => {
  assert.throws(() => buildProdReleaseReview({ ...evidence, projectRef: 'ecsdwrarzfexssxtrymj' }, {}, policy));
  assert.throws(() => buildProdReleaseReview({ ...evidence, sourceSha256: '' }, {}, policy));
});
test('protected applied-file drift remains a release blocker', () => {
  const p = { migrations: [{ file: older, sha256: sha256('original'), prodStatus: 'blocked', reason: 'DEV-only' }] };
  const result = buildProdReleaseReview({ ...evidence, appliedVersions: ['20260928122526'] }, { [older]: 'changed' }, p);
  assert.match(result.issues[0], /removed or edited/);
});
test('complete owner export contains 1137 unique applied versions and all 38 current files remain pending', () => {
  const real = JSON.parse(readFileSync(new URL('../docs/release-review/prod-evidence-2026-10-30.json', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => [f, readFileSync(new URL(f, dir), 'utf8')]));
  const p = JSON.parse(readFileSync(new URL('./auth-release-policy.json', import.meta.url), 'utf8'));
  const result = buildProdReleaseReview(real, files, p);
  assert.equal(result.appliedCount, 1137);
  assert.equal(new Set(real.appliedVersions).size, 1137);
  assert.equal(result.pendingCount, 38);
  assert.equal(result.migrations.length, 38);
  assert.equal(result.issues.length, 38);
});
test('transition dispositions cannot authorize execution even when every original is classified', () => {
  const files = { [older]: 'select 1;' };
  const notes = [{ file: older, sha256: sha256(files[older]), disposition: 'verify-overlap', reason: 'Needs exact target acceptance' }];
  const result = buildProdTransitionReview(evidence, files, policy, notes);
  assert.equal(result.deploymentAuthorized, false);
  assert.equal(result.reviewOnly, true);
  assert.equal(result.migrations[0].releaseStatus, 'hold');
  assert.equal(result.issues.length, 1);
});
test('missing, reordered, stale or executable dispositions fail closed', () => {
  const files = { [older]: 'select 1;', '20261030030705_new.sql': 'select 2;' };
  const notes = Object.keys(files).sort().map(file => ({ file, sha256: sha256(files[file]), disposition: 'adapt', reason: 'Held' }));
  for (const bad of [notes.slice(1), [...notes].reverse(), notes.map(e => ({ ...e, sha256: sha256('stale') })), notes.map(e => ({ ...e, disposition: 'approved' }))]) {
    assert.throws(() => buildProdTransitionReview(evidence, files, policy, bad));
  }
});
test('historical transition preserves 37 originals and fails closed on the newly added AI migration', () => {
  const record = JSON.parse(readFileSync(new URL('../docs/release-review/transition-dispositions-2026-10-30.json', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => [f, readFileSync(new URL(f, dir), 'utf8')]));
  assert.deepEqual(Object.keys(files).filter(f => !record.migrations.some(e => e.file === f)),
    ['20261030052009_17c7388f-6d82-4683-ba3a-5b64a0b78ada.sql']);
  const real = JSON.parse(readFileSync(new URL('../docs/release-review/prod-evidence-2026-10-30.json', import.meta.url), 'utf8'));
  const p = JSON.parse(readFileSync(new URL('./auth-release-policy.json', import.meta.url), 'utf8'));
  assert.throws(() => buildProdTransitionReview(real, files, p,
    record.migrations.map(e => ({ ...e, reason: e.transitionReason }))), /Complete ordered hash-matched source dispositions required/);
  for (const entry of record.migrations) {
    assert.equal(entry.sha256, sha256(files[entry.file]));
    assert.equal(entry.releaseStatus, 'hold');
  }
  const excluded = record.migrations.filter(e => e.disposition === 'exclude-original').map(e => e.file.slice(0, 14));
  assert.deepEqual(excluded, ['20261030013157', '20261030013232', '20261030013444', '20261030013735', '20261030014542', '20261030014712', '20261030030705', '20261030030741', '20261030031128']);
  assert.equal(record.deploymentAuthorized, false);
});