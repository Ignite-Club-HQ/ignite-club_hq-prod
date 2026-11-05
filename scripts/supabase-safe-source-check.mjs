import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSafeInputs, planSafeStaging } from './supabase-safe-staging.mjs';
import { planSafeApply } from './supabase-safe-apply.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  assert.equal(approval.migrations.length, 6, 'Existing six-migration approval required');
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