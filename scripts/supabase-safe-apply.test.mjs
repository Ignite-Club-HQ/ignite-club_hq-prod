import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

const flagged = `${a}: Function expression public.is_competition_admin: requires separate review`;
const ledger = (entry = {}) => ({
  schemaVersion: 1, projectRef: SAFE_TARGET, reviewedBy: 'Paul Cranwell',
  findings: [{ file: a, sha256: digest(files[a]),
    finding: 'Function expression public.is_competition_admin: requires separate review', occurrences: 1, ...entry }],
});

test('an owner-reviewed finding on the exact fingerprinted file releases the batch', () => {
  assert.deepEqual(planSafeApply(approval(a), staged, files, [flagged], ledger()).apply.map(x => x.file), [a]);
});
test('a finding the ledger does not carry still stops the batch', () => {
  assert.throws(() => planSafeApply(approval(a), staged, files, [flagged, `${a}: data write`], ledger()), /structural/);
  assert.throws(() => planSafeApply(approval(a), staged, files, [flagged], { ...ledger(), findings: [] }), /structural/);
  assert.throws(() => planSafeApply(approval(a), staged, files, [flagged], { ...ledger(), reviewedBy: '  ' }), /ledger/);
});
test('an edited file invalidates its recorded finding review', () => {
  const edited = { ...files, [a]: files[a] + ' -- changed' };
  const ok = { ...approval(a), migrations: [{ file: a, sha256: digest(edited[a]) }] };
  assert.throws(() => planSafeApply(ok, staged, edited, [flagged], ledger()), /structural/);
});
test('a review that undercounts occurrences stops the batch', () => {
  const twice = [flagged, flagged];
  assert.throws(() => planSafeApply(approval(a), staged, files, twice, ledger()), /structural/);
  assert.deepEqual(planSafeApply(approval(a), staged, files, twice, ledger({ occurrences: 2 })).apply.length, 1);
});
test('a review bound to a file nobody approved is rejected', () => {
  assert.throws(() => planSafeApply(approval(a), staged, files, [flagged],
    ledger({ file: b })), /not bound to an approved file/);
});
test('a review for the wrong target is rejected', () => {
  assert.throws(() => planSafeApply(approval(a), staged, files, [flagged],
    { ...ledger(), projectRef: 'other_project' }), /ledger/);
});

const SIX = [
  '20261104031935_1dee9461-4e42-4edf-a3cb-20110c767259.sql',
  '20261105000000_competition_fixture_visibility.sql',
  '20261105000100_competition_vault_access.sql',
  '20261105000200_competition_role_email_invites.sql',
  '20261105000300_club_invite_message_defaults.sql',
  '20261105000400_send_welcome_dm.sql',
].sort();

function realRelease() {
  const input = readSafeInputs(process.cwd());
  const policy = JSON.parse(readFileSync('scripts/auth-release-policy.json', 'utf8'));
  const staged = planSafeStaging(input.manifest, input.files, policy, []);
  const candidates = Object.fromEntries(staged.candidates.map(entry => [entry.file, input.files[entry.file]]));
  const check = spawnSync('python3', ['scripts/structural-sql-check.py'],
    { input: JSON.stringify(candidates), encoding: 'utf8' });
  assert.equal(check.error, undefined, 'structural parser must be available');
  return { input, staged, findings: JSON.parse(check.stdout),
    approval: JSON.parse(readFileSync('docs/release-review/safe-apply-approval.json', 'utf8')),
    reviewed: JSON.parse(readFileSync('docs/release-review/safe-apply-reviewed-findings.json', 'utf8')) };
}

test('repository approval selects exactly the six owner-approved structural batches', () => {
  const { input, staged, findings, approval: ok, reviewed } = realRelease();
  const { apply } = planSafeApply(ok, staged, input.files, findings, reviewed);
  assert.deepEqual(apply.map(x => x.file), SIX);
});
test('without the reviewed-findings ledger the flagged batches stop the release', () => {
  const { input, staged, findings, approval: ok } = realRelease();
  assert.throws(() => planSafeApply(ok, staged, input.files, findings, null), /structural check failed/);
});
test('every recorded finding matches the live parser output byte for byte', () => {
  const { input, approval: ok, reviewed } = realRelease();
  const live = new Set();
  for (const entry of reviewed.findings) {
    const sql = input.files[entry.file];
    assert.equal(digest(sql), entry.sha256, `${entry.file} fingerprint drifted`);
    const check = spawnSync('python3', ['scripts/structural-sql-check.py'],
      { input: JSON.stringify({ [entry.file]: sql }), encoding: 'utf8' });
    const found = JSON.parse(check.stdout).map(f => f.slice(entry.file.length + 2));
    assert.equal(found.filter(f => f === entry.finding).length, entry.occurrences, `${entry.file}: ${entry.finding}`);
    live.add(`${entry.file}\u0000${entry.finding}`);
  }
  for (const f of reviewed.findings) assert.ok(live.has(`${f.file}\u0000${f.finding}`));
});

test('the five batch files are the reviewed candidates split without edits', () => {
  const strip = name => readFileSync(`supabase/migrations/${name}`, 'utf8').split('\n').slice(1).join('\n');
  const competition = ['20261105000000_competition_fixture_visibility.sql',
    '20261105000100_competition_vault_access.sql', '20261105000200_competition_role_email_invites.sql']
    .map(strip).join('\n');
  const invitation = ['20261105000300_club_invite_message_defaults.sql', '20261105000400_send_welcome_dm.sql']
    .map(strip).join('\n');
  assert.equal(competition, readFileSync('docs/release-review/competition-functions-prod-candidate.sql', 'utf8'));
  assert.equal(invitation, readFileSync('docs/release-review/invitation-welcome-prod-candidate.sql', 'utf8'));
});

test('the safe-apply runner applies exactly the six approved batches, one transaction each', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'safe-apply-runner-'));
  const log = path.join(temp, 'commands');
  try {
    writeFileSync(path.join(temp, 'psql'), [
      '#!/bin/sh',
      'for a in "$@"; do',
      '  if [ "$a" = "--single-transaction" ]; then',
      '    printf "\\n=== WRITE ===\\n" >> "$SAFE_TEST_LOG"',
      '    cat >> "$SAFE_TEST_LOG"',
      '    exit 0',
      '  fi',
      'done',
      'printf "[]"',
      '',
    ].join('\n'), { mode: 0o755 });
    const result = spawnSync(process.execPath, ['scripts/supabase-structural-release.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, SAFE_TEST_LOG: log,
        GITHUB_REF: 'refs/heads/prod', PROJECT_REF: SAFE_TARGET,
        SUPABASE_ACCESS_TOKEN: 'fixture-only', SUPABASE_DB_PASSWORD: 'fixture-only',
        GITHUB_SHA: 'a'.repeat(40), RELEASE_MODE: 'safe-apply', RELEASE_REPORT_DIR: temp },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(path.join(temp, 'release-report.json'), 'utf8'));
    assert.equal(report.phase, 'safe-apply-complete');
    assert.deepEqual(report.apply, SIX);
    assert.deepEqual(report.applied, SIX);
    assert.deepEqual(report.alreadyApplied, []);
    assert.equal(report.held.length, 38);
    assert.equal(report.dataCopy, false);
    const input = readSafeInputs(process.cwd());
    const written = readFileSync(log, 'utf8').split('\n=== WRITE ===\n').slice(1);
    assert.equal(written.length, 6, 'one transaction per approved file');
    for (const file of SIX) {
      const version = file.split('_')[0];
      const name = file.slice(15, -4);
      const chunk = written.find(part => part.startsWith(input.files[file]));
      assert.ok(chunk, `${file}: its exact SQL was not submitted`);
      assert.equal(chunk.match(/INSERT INTO supabase_migrations\.schema_migrations/g)?.length, 1,
        `${file}: exactly one truthful ledger row`);
      assert.match(chunk, new RegExp(`VALUES \\('${version}', '${name}'\\)`));
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
