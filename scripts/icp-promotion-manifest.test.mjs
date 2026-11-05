// Guards for the file list that may be promoted into the live repository.
// The risk these tests exist for: a promotion that overwrites live code, drags
// the development canister IDs into the live release tools, or hands over a
// layer with a hole in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROD_REPO,
  PROD_BRANCH,
  ICP_SOURCE_FILES,
  promotionFiles,
  missingSourceEntries,
  planPromotion,
  filesToWrite,
  assertPromotionTarget,
  historicalSourceFiles,
} from './icp-promotion-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('historical code release preserves PROD configuration, IDs, data, tools and website', () => {
  assert.deepEqual(historicalSourceFiles(['backend/club_domain/src/main.mo', 'backend/club_domain/main.wasm', 'backend/AGENTS.md', 'backend/.icp/data/ic.ids.json', 'Cargo.toml', 'deploy/prod/icp.yaml', 'deploy/prod/release.json', 'scripts/deploy-mainnet.sh', 'src/App.tsx', 'supabase/migrations/example.sql']), ['Cargo.toml', 'backend/club_domain/src/main.mo']);
});

// A checkout that carries both environments' files, the live repository's own
// app code, and the generated or state-bearing files that must never travel.
const SAMPLE = [
  'backend/club_domain/main.mo',
  'backend/club_domain/main.wasm',
  'backend/club_domain/.mops/base@0.14.5/src/List.mo',
  'backend/shared/util.mo',
  'deploy/prod/icp.yaml',
  'deploy/prod/.icp/data/mappings/ic.ids.json',
  'deploy/prod/release.json',
  'deploy/mainnet/icp.yaml',
  'mops.toml',
  'mops.lock',
  'scripts/icp-environments.mjs',
  'scripts/deploy-mainnet.sh',
  'src/App.tsx',
  'frontend/src/main.tsx',
  'frontend/scripts/media-stage-two-github.mjs',
  '.github/workflows/promote-icp-prod.yml',
  '.github/workflows/fund-prod-canisters-by-card.yml',
];

test('the promotion carries canister sources, settings and release tooling', () => {
  const copy = promotionFiles(SAMPLE);
  for (const file of [
    'backend/club_domain/main.mo',
    'backend/shared/util.mo',
    'deploy/prod/icp.yaml',
    'mops.toml',
    'mops.lock',
    'scripts/icp-environments.mjs',
    'scripts/deploy-mainnet.sh',
    'frontend/scripts/media-stage-two-github.mjs',
    '.github/workflows/promote-icp-prod.yml',
    '.github/workflows/fund-prod-canisters-by-card.yml',
  ]) {
    assert.ok(copy.includes(file), `${file} must reach the live repository`);
  }
});

test('the promotion leaves out generated output, live state and anything not allowlisted', () => {
  const copy = promotionFiles(SAMPLE);
  for (const file of [
    'backend/club_domain/main.wasm', // rebuilt by the deploy
    'backend/club_domain/.mops/base@0.14.5/src/List.mo', // installed dependency
    'deploy/prod/.icp/data/mappings/ic.ids.json', // live canister IDs, written by provisioning
    'deploy/prod/release.json', // live release progress
    'deploy/mainnet/icp.yaml', // the development canister set
    'src/App.tsx', // the live repository's own app code
    'frontend/src/main.tsx',
  ]) {
    assert.ok(!copy.includes(file), `${file} must never be promoted`);
  }
  assert.ok(copy.every((file) => !/ic\.ids\.json|release\.json|(^|\/)\.icp\//.test(file)));
});

test('a checkout with manifest holes is refused, and the holes are named', () => {
  const holes = missingSourceEntries(SAMPLE);
  assert.ok(holes.includes('scripts/record-prod-release.mjs'), 'a tooling file the sample lacks must be reported');
  assert.ok(!holes.includes('mops.toml'), 'a file the sample has must not be reported');
  assert.deepEqual(missingSourceEntries([]).length > 0, true, 'an empty checkout is entirely holes');
  assert.deepEqual(missingSourceEntries(SAMPLE.concat(ICP_SOURCE_FILES)).length, 0, 'a complete checkout has no holes');
});

test('every file the manifest names still exists in this checkout', () => {
  const absent = ICP_SOURCE_FILES.filter((file) => !existsSync(path.join(ROOT, file)));
  assert.deepEqual(absent, [], 'the manifest must not name a file that no longer exists');
});

test('a copy run only adds files the live repository does not have', () => {
  const plan = planPromotion({ files: SAMPLE, existing: ['mops.toml', 'scripts/deploy-mainnet.sh'] });
  assert.ok(!plan.copy.includes('mops.toml'), 'an existing file must not be re-added');
  assert.ok(plan.copy.includes('backend/club_domain/main.mo'), 'an absent file must be added');
  assert.ok(plan.alreadyPresent.includes('mops.toml'), 'left-alone files must be reported');
});

test('ticking overwrite really writes the differing files', () => {
  const write = filesToWrite({ add: ['a.mo'], differ: ['scripts/icp-environments.test.mjs'], allowDrift: true });
  assert.deepEqual(write, ['a.mo', 'scripts/icp-environments.test.mjs']);
});

test('without overwrite, differing files stop the run', () => {
  assert.equal(filesToWrite({ add: ['a.mo'], differ: ['x.mjs'], allowDrift: false }), null);
  assert.deepEqual(filesToWrite({ add: ['a.mo'], differ: [], allowDrift: false }), ['a.mo']);
});

test('a promotion can only land on the live repository release branch', () => {
  assert.doesNotThrow(() => assertPromotionTarget({ dest: PROD_REPO, branch: PROD_BRANCH }));
  assert.throws(() => assertPromotionTarget({ dest: 'Ignite-Club-HQ/ignite-club-hybrid', branch: PROD_BRANCH }), /live repository/);
  assert.throws(() => assertPromotionTarget({ dest: PROD_REPO, branch: 'main' }), /prod branch/);
  assert.throws(() => assertPromotionTarget({ dest: PROD_REPO, branch: 'integration-hybrid' }), /prod branch/);
});
