import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function auditAuthRelease(policy, files, appliedVersions) {
  if (!Array.isArray(appliedVersions) || appliedVersions.some(v => typeof v !== 'string' || !/^\d+$/.test(v))) throw new Error('Verified target migration versions required as a JSON array of decimal strings');
  if (new Set(appliedVersions).size !== appliedVersions.length) throw new Error('Target migration ledger contains duplicate versions');
  const migrationName = /^\d{14}_[A-Za-z0-9_-]+\.sql$/;
  if (!policy || !Array.isArray(policy.migrations)) throw new Error('Migration release policy required');
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Migration file inventory required');
  const versions = new Set();
  for (const [file, sql] of Object.entries(files)) {
    const version = file.split('_')[0];
    if (!migrationName.test(file) || typeof sql !== 'string' || versions.has(version)) throw new Error('Invalid or duplicate migration file inventory');
    versions.add(version);
  }
  const policyVersions = new Set();
  for (const entry of policy.migrations) {
    if (!entry || typeof entry.file !== 'string' || !migrationName.test(entry.file)
      || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')
      || !['blocked', 'approved'].includes(entry.prodStatus)
      || typeof entry.reason !== 'string' || !entry.reason.trim()
      || policyVersions.has(entry.file.split('_')[0])) throw new Error('Invalid or duplicate migration policy entry');
    policyVersions.add(entry.file.split('_')[0]);
  }
  const applied = new Set(appliedVersions);
  const issues = [];
  const classified = new Set(policy.migrations.map(m => m.file));
  for (const entry of policy.migrations) {
    const sql = files[entry.file];
    if (typeof sql !== 'string' || createHash('sha256').update(sql).digest('hex') !== entry.sha256) issues.push(`${entry.file}: protected migration was removed or edited`);
    if (!applied.has(entry.file.split('_')[0]) && entry.prodStatus !== 'approved') issues.push(`${entry.file}: ${entry.reason}`);
  }
  for (const file of Object.keys(files)) {
    if (!classified.has(file) && !applied.has(file.split('_')[0])) issues.push(`${file}: new migration has no production release classification`);
  }
  return issues;
}

/** Compare the existing runner's complete plan, not a filtered substitute. No deployment is performed. */
export function auditAuthMigrationPlan(policy, files, appliedVersions, plan) {
  const issues = auditAuthRelease(policy, files, appliedVersions);
  if (!Array.isArray(plan) || plan.some(entry => !entry || typeof entry.file !== 'string' || typeof entry.sha256 !== 'string')) throw new Error('Ordered migration plan with file hashes required');
  const applied = new Set(appliedVersions);
  const expected = Object.keys(files).filter(file => !applied.has(file.split('_')[0])).sort();
  if (plan.length !== expected.length || plan.some((entry, index) => entry.file !== expected[index])) issues.push('Runner plan does not match the complete ordered pending migration inventory; exclusions require separate approved reconciliation');
  for (const entry of plan) {
    if (typeof files[entry.file] !== 'string' || createHash('sha256').update(files[entry.file]).digest('hex') !== entry.sha256) issues.push(`${entry.file}: runner plan hash does not match source`);
  }
  return issues;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const versionsFile = process.argv[2];
    if (!versionsFile) throw new Error('Provide a reviewed JSON file of PROD migration versions; no database is contacted by this tool');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const dir = path.join(root, 'supabase/migrations');
    const files = Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => [f, readFileSync(path.join(dir, f), 'utf8')]));
    const policy = JSON.parse(readFileSync(path.join(root, 'scripts/auth-release-policy.json'), 'utf8'));
    const applied = JSON.parse(readFileSync(versionsFile, 'utf8'));
    const planFile = process.argv[3];
    const issues = planFile
      ? auditAuthMigrationPlan(policy, files, applied, JSON.parse(readFileSync(planFile, 'utf8')))
      : auditAuthRelease(policy, files, applied);
    if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
    else console.log(`Auth migration preflight passed for the supplied target ledger${planFile ? ' and ordered plan' : ' (runner plan not checked)'}; this is not deployment approval.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}