import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildProdReleaseReview, sha256 } from './prod-release-review.mjs';

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
test('complete owner export contains 1137 unique applied versions and all 37 current files remain pending', () => {
  const real = JSON.parse(readFileSync(new URL('../docs/release-review/prod-evidence-2026-10-30.json', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => [f, readFileSync(new URL(f, dir), 'utf8')]));
  const p = JSON.parse(readFileSync(new URL('./auth-release-policy.json', import.meta.url), 'utf8'));
  const result = buildProdReleaseReview(real, files, p);
  assert.equal(result.appliedCount, 1137);
  assert.equal(new Set(real.appliedVersions).size, 1137);
  assert.equal(result.pendingCount, 37);
  assert.equal(result.migrations.length, 37);
  assert.equal(result.issues.length, 37);
});