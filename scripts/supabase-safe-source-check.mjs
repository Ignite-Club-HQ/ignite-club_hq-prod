import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSafeInputs, planSafeStaging } from './supabase-safe-staging.mjs';
import { planSafeApply } from './supabase-safe-apply.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPROVED_FILES = [
  '20261104031935_1dee9461-4e42-4edf-a3cb-20110c767259.sql',
  '20261105000000_competition_fixture_visibility.sql',
  '20261105000100_competition_vault_access.sql',
  '20261105000200_competition_role_email_invites.sql',
  '20261105000300_club_invite_message_defaults.sql',
  '20261105000400_send_welcome_dm.sql',
  '20261109232052_a578f787-ba4e-4669-8bf0-c6ce2e552389.sql',
  '20261111075407_ba34e1c2-bd8e-48f2-8993-461b53e500a9.sql', '20261111185226_616130d3-ba85-4aa1-8dfb-4d4c752869bf.sql', '20261111190554_1ec9242a-4756-47e6-b5fd-257ad86a61a5.sql',
];

/** Offline consistency only. An empty ledger makes no claim about target history. */
export function validateSafeSources(root = ROOT) {
  const json = relative => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
  const { files, manifest } = readSafeInputs(root);
  const staged = planSafeStaging(manifest, files, json('scripts/auth-release-policy.json'), []);
  const approval = json('docs/release-review/safe-apply-approval.json');
  const reviewed = json('docs/release-review/safe-apply-reviewed-findings.json');
  const candidates = Object.fromEntries(staged.candidates.map(({ file }) => [file, files[file]]));
  const check = spawnSync('python3', [path.join(ROOT, 'scripts/structural-sql-check.py')], {
    input: JSON.stringify(candidates), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000,
  });
  if (check.error || ![0, 1].includes(check.status)) throw new Error('Offline SQL parser unavailable');
  const findings = JSON.parse(check.stdout);
  if (!Array.isArray(findings) || findings.some(f => typeof f !== 'string')) throw new Error('Invalid SQL parser findings');
  assert.deepEqual(approval.migrations.map(({ file }) => file).sort(), APPROVED_FILES, 'Existing exact owner-approved migration inventory required');
  const { apply, skipped } = planSafeApply(approval, staged, files, findings, reviewed);
  assert.deepEqual(skipped, [], 'Every offline approval must be a candidate');
  assert.deepEqual(apply.map(({ file }) => file), approval.migrations.map(({ file }) => file).sort());
  return { sourceInventory: staged.sourceInventory, approved: apply.map(({ file }) => file), held: staged.held,
    deploymentAuthorized: false, historyWrites: false, targetVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = validateSafeSources();
    console.log(`Offline sources valid: ${r.sourceInventory.length} originals, ${r.approved.length} approved, ${r.held.length} held. No target verification or deployment authorization.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}