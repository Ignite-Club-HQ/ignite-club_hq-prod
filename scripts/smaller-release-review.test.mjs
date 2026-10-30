import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildSmallerReleaseReview, readSmallerReleaseInputs } from './smaller-release-review.mjs';

const inputs = readSmallerReleaseInputs(fileURLToPath(new URL('../', import.meta.url)));

test('smaller release excludes both score transitions and AI activation, preserving existing scores', () => {
  const review = buildSmallerReleaseReview(inputs);
  assert.deepEqual(review.migrationInventory.filter(entry => entry.scope === 'deferred-score-work').map(entry => entry.file), [
    '20261021003048_cc898ea3-1b7f-44d1-81d4-e894260fa5f2.sql',
    '20261021003143_71991b81-2fcd-49f9-b35f-6f9b21e593d2.sql',
    '20261030052009_17c7388f-6d82-4683-ba3a-5b64a0b78ada.sql',
  ]);
  assert.equal(review.inventoryCount, 38);
  assert.ok(review.migrationInventory.every(entry => entry.executeOriginal === false));
  assert.equal(review.deploymentAuthorized, false);
  assert.equal(review.mergeAuthorized, false);
  assert.equal(review.dataClearingAuthorized, false);
});

test('only separate signup drafts and sign-in/placement sources enter the review', () => {
  const review = buildSmallerReleaseReview(inputs);
  assert.deepEqual(review.candidates.map(entry => entry.file), [
    'docs/release-review/signup-helper-draft.sql', 'docs/release-review/signup-access-draft.sql',
  ]);
  assert.ok(review.candidates.every(entry => entry.execute === false));
  assert.equal(review.sourceScope.length, 8);
  assert.throws(() => buildSmallerReleaseReview({ ...inputs, drafts: { ...inputs.drafts, 'score.sql': 'select 1;' } }));
  assert.throws(() => buildSmallerReleaseReview({ ...inputs, sourceFiles: { ...inputs.sourceFiles, 'frontend/src/pages/ScoreHistoryReviewPage.tsx': 'score tool' } }));
});

test('all originals stay hash-bound including the newly added DEV AI migration', () => {
  const names = Object.keys(inputs.files);
  for (const file of [names[0], '20261030052009_17c7388f-6d82-4683-ba3a-5b64a0b78ada.sql']) {
    assert.throws(() => buildSmallerReleaseReview({ ...inputs, files: { ...inputs.files, [file]: 'changed' } }));
  }
  assert.throws(() => buildSmallerReleaseReview({ ...inputs, files: Object.fromEntries(Object.entries(inputs.files).slice(1)) }));
  assert.throws(() => buildSmallerReleaseReview({ ...inputs, files: { ...inputs.files, '20261101000000_unreviewed.sql': 'select 1;' } }));
});

test('prior approval flags and substituted target evidence cannot unlock the smaller review', () => {
  assert.throws(() => buildSmallerReleaseReview({ ...inputs, priorReview: { ...inputs.priorReview, deploymentAuthorized: true } }));
  assert.throws(() => buildSmallerReleaseReview({ ...inputs, evidence: { ...inputs.evidence, sourceSha256: '0'.repeat(64) } }));
});