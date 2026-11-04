import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { planSafeApply } from './supabase-safe-apply.mjs';
import { planSafeStaging, readSafeInputs, SAFE_TARGET } from './supabase-safe-staging.mjs';

const digest = t => createHash('sha256').update(t).digest('hex');
const a = '20261104000000_safe.sql', b = '20261104000001_held.sql';
const files = { [a]: 'SELECT 1;', [b]: 'SELECT 2;' };
const staged = { candidates: [{ file: a }], held: [{ file: b }] };
const approval = f => ({ schemaVersion: 1, projectRef: SAFE_TARGET, approvedBy: 'Paul Cranwell', migrations: [{ file: f, sha256: digest(files[f]) }] });

test('applies only the approved candidate', () => {
  assert.deepEqual(planSafeApply(approval(a), staged, files, []).apply.map(x => x.file), [a]);
});
test('held original can never be approved', () => {
  assert.throws(() => planSafeApply(approval(b), staged, files, []), /held/);
});
test('edited source or structural finding stops', () => {
  assert.throws(() => planSafeApply(approval(a), staged, { ...files, [a]: 'DELETE FROM x;' }, []), /fingerprint/);
  assert.throws(() => planSafeApply(approval(a), staged, files, [`${a}: data write`]), /structural/);
});
test('already applied approved file is skipped, not rerun', () => {
  const r = planSafeApply(approval(a), { candidates: [], held: [{ file: b }] }, files, []);
  assert.deepEqual([r.apply.length, r.skipped], [0, [a]]);
});
test('repository approval selects only the email signup invitation check', () => {
  const input = readSafeInputs(process.cwd());
  const policy = JSON.parse(readFileSync('scripts/auth-release-policy.json', 'utf8'));
  const real = planSafeStaging(input.manifest, input.files, policy, []);
  const ok = JSON.parse(readFileSync('docs/release-review/safe-apply-approval.json', 'utf8'));
  assert.deepEqual(planSafeApply(ok, real, input.files, []).apply.map(x => x.file), ['20261104031935_1dee9461-4e42-4edf-a3cb-20110c767259.sql']);
});
