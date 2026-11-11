import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateSafeSources } from './supabase-safe-source-check.mjs';
import { readSafeInputs } from './supabase-safe-staging.mjs';

const root = path.resolve(import.meta.dirname, '..');
const APPROVED = ['20261104031935_1dee9461-4e42-4edf-a3cb-20110c767259.sql',
  '20261105000000_competition_fixture_visibility.sql', '20261105000100_competition_vault_access.sql',
  '20261105000200_competition_role_email_invites.sql', '20261105000300_club_invite_message_defaults.sql',
  '20261105000400_send_welcome_dm.sql', '20261109232052_a578f787-ba4e-4669-8bf0-c6ce2e552389.sql', '20261111075407_ba34e1c2-bd8e-48f2-8993-461b53e500a9.sql', '20261111185226_616130d3-ba85-4aa1-8dfb-4d4c752869bf.sql', '20261111190554_1ec9242a-4756-47e6-b5fd-257ad86a61a5.sql'];

test('offline validation preserves all originals and the seven already-approved sources, not deployment authority', () => {
  const r = validateSafeSources(root);
  assert.deepEqual(r.approved, APPROVED);
  assert.equal(r.held.length, 39);
  assert.deepEqual(r.sourceInventory.map(({ file, sha256 }) => ({ file, sha256 })),
    readSafeInputs(root).manifest.sources.map(({ file, sha256 }) => ({ file, sha256 })));
  assert.equal(r.deploymentAuthorized, false);
  assert.equal(r.historyWrites, false);
  assert.equal(r.targetVerified, false);
});

test('edited held SQL fails the complete inventory check', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'safe-source-test-'));
  try {
    const input = readSafeInputs(root);
    for (const [file, sql] of Object.entries(input.files)) {
      mkdirSync(path.join(temp, 'supabase/migrations'), { recursive: true });
      writeFileSync(path.join(temp, 'supabase/migrations', file), sql);
    }
    for (const file of ['scripts/auth-release-policy.json', 'docs/release-review/safe-release-manifest.json',
      'docs/release-review/safe-apply-approval.json', 'docs/release-review/safe-apply-reviewed-findings.json']) {
      mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
      writeFileSync(path.join(temp, file), readFileSync(path.join(root, file)));
    }
    const held = input.manifest.sources.find(s => s.disposition === 'hold');
    assert.ok(held);
    writeFileSync(path.join(temp, 'supabase/migrations', held.file), input.files[held.file] + '\nDELETE FROM public.clubs;');
    assert.throws(() => validateSafeSources(temp), /fingerprint/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('PROD PR source check has no credentials or live executor and leaves runtime promotion separate', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /if: github\.base_ref == 'prod'/);
  assert.match(workflow, /node scripts\/supabase-safe-source-check\.mjs/);
  assert.doesNotMatch(workflow, /supabase-structural-release\.mjs|SUPABASE_DB_PASSWORD|SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(workflow, /PROD auth release is blocked pending/);
});