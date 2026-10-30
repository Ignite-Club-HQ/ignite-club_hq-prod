import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './prod-release-review.mjs';

const AI_MIGRATION = '20261030052009_17c7388f-6d82-4683-ba3a-5b64a0b78ada.sql';
const AI_HASH = 'ba253e4dd9b5ecacc450ac39af6a2601ae32bf21dff4da5776966d076eb63d5b';
const SCORE_MIGRATIONS = new Set([
  '20261021003048_cc898ea3-1b7f-44d1-81d4-e894260fa5f2.sql',
  '20261021003143_71991b81-2fcd-49f9-b35f-6f9b21e593d2.sql',
  AI_MIGRATION,
]);

/** Complete source inventory, never an executable migration plan or release grant. */
export function buildSmallerReleaseReview({ files, priorReview, evidence, drafts, sourceFiles }) {
  if (priorReview?.reviewOnly !== true || priorReview.deploymentAuthorized !== false
      || evidence?.projectRef !== 'yabcfiuntwqjwvschnji'
      || priorReview.evidenceSourceSha256 !== evidence.sourceSha256) {
    throw new Error('Held source-bound production evidence required');
  }
  const expected = [...priorReview.migrations.map(entry => ({ file: entry.file, sha256: entry.sha256 })),
    { file: AI_MIGRATION, sha256: AI_HASH }].sort((a, b) => a.file.localeCompare(b.file));
  const actual = Object.keys(files).sort();
  if (new Set(expected.map(entry => entry.file)).size !== expected.length
      || actual.length !== expected.length
      || expected.some((entry, index) => entry.file !== actual[index] || sha256(files[entry.file]) !== entry.sha256)) {
    throw new Error('Complete unchanged migration inventory required; new files need separate review');
  }
  const requiredDrafts = ['signup-helper-draft.sql', 'signup-access-draft.sql'];
  if (Object.keys(drafts).sort().join('|') !== [...requiredDrafts].sort().join('|')
      || Object.values(drafts).some(sql => typeof sql !== 'string' || !sql.trim())) {
    throw new Error('Only the separate signup helper and access drafts belong in this scope');
  }
  const expectedSources = [
    'frontend/src/components/AuthMethodChoice.tsx',
    'frontend/src/components/ClubBackendEnforcement.tsx',
    'frontend/src/components/IcpSignInScreen.tsx',
    'frontend/src/lib/emailSignupPolicy.ts',
    'frontend/src/live/authBackendMode.ts',
    'frontend/src/live/backendRouting.ts',
    'frontend/src/pages/AuthPage.tsx',
    'frontend/src/pages/PlacementAdminSettingsPage.tsx',
  ].sort();
  if (Object.keys(sourceFiles).sort().join('|') !== expectedSources.join('|')
      || Object.values(sourceFiles).some(text => typeof text !== 'string' || !text.trim())) {
    throw new Error('Exact sign-in and placement-settings source scope required');
  }
  return {
    schemaVersion: 1, reviewOnly: true, deploymentAuthorized: false,
    mergeAuthorized: false, dataClearingAuthorized: false,
    independentlyVerifiedConnection: false,
    projectRef: evidence.projectRef, evidenceSourceSha256: evidence.sourceSha256,
    inventoryCount: actual.length,
    sourceScope: expectedSources.map(file => ({ file, sha256: sha256(sourceFiles[file]), status: 'dependency-review-required' })),
    migrationInventory: expected.map(entry => ({ ...entry, executeOriginal: false,
      scope: SCORE_MIGRATIONS.has(entry.file) ? 'deferred-score-work' : 'excluded-original',
      reason: SCORE_MIGRATIONS.has(entry.file)
        ? 'Preserve current production scores and History; no AI activation'
        : 'Smaller release uses separately reviewed auth candidates only; never replay this original',
    })),
    candidates: requiredDrafts.map(file => ({ file: `docs/release-review/${file}`, sha256: sha256(drafts[file]),
      status: 'isolated-rehearsal-only', execute: false })),
    preservedBehaviour: ['Existing score and History storage/read/write behaviour',
      'Production handle_new_user and existing account AFTER triggers',
      'Existing push schedules, credentials, audiences and queue configuration',
      'Existing administrator entitlements; no new role or media/Vault authority'],
    deferredNotBlockers: ['Score/History reconciliation and privacy transitions',
      'AI score review activation and its access-state table',
      'Nine feature adaptations beyond this auth-only scope',
      'New competition-role self-removal activation'],
    releaseBlockers: [
      'Selective source/dependency review against the exact production commit; a whole-main merge is not this smaller release',
      'Approved complete original/replacement staging mechanism, without ledger repair or editing DEV-applied files',
      'Independent target reconciliation and representative signup/profile/invitation acceptance',
      'Fresh production routing read and verified retained-club membership before separately approved activation',
      'Hosted email/confirmation and Internet Identity configuration plus authenticated sign-in acceptance',
      'Netlify/Codemagic environment settings and exact-commit publication sequencing',
    ],
  };
}

export function readSmallerReleaseInputs(root) {
  const readJson = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  const readFiles = names => Object.fromEntries(names.map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
  const migrationDirectory = path.join(root, 'supabase/migrations');
  return {
    files: Object.fromEntries(readdirSync(migrationDirectory).filter(file => file.endsWith('.sql'))
      .map(file => [file, readFileSync(path.join(migrationDirectory, file), 'utf8')])),
    priorReview: readJson('docs/release-review/transition-dispositions-2026-10-30.json'),
    evidence: readJson('docs/release-review/prod-evidence-2026-10-30.json'),
    drafts: Object.fromEntries(['signup-helper-draft.sql', 'signup-access-draft.sql']
      .map(file => [file, readFileSync(path.join(root, 'docs/release-review', file), 'utf8')])),
    sourceFiles: readFiles([
      'frontend/src/components/AuthMethodChoice.tsx', 'frontend/src/components/ClubBackendEnforcement.tsx',
      'frontend/src/components/IcpSignInScreen.tsx', 'frontend/src/lib/emailSignupPolicy.ts',
      'frontend/src/live/authBackendMode.ts', 'frontend/src/live/backendRouting.ts',
      'frontend/src/pages/AuthPage.tsx', 'frontend/src/pages/PlacementAdminSettingsPage.tsx',
    ]),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    console.log(JSON.stringify(buildSmallerReleaseReview(readSmallerReleaseInputs(root)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}