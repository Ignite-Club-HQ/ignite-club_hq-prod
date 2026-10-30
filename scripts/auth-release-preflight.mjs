import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function auditAuthRelease(policy, files, appliedVersions) {
  if (!Array.isArray(appliedVersions) || appliedVersions.some(v => typeof v !== 'string' || !/^\d+$/.test(v))) throw new Error('Verified target migration versions required as a JSON array of decimal strings');
  const applied = new Set(appliedVersions);
  const issues = [];
  const classified = new Set(policy.migrations.map(m => m.file));
  for (const entry of policy.migrations) {
    const sql = files[entry.file];
    if (typeof sql !== 'string' || createHash('sha256').update(sql).digest('hex') !== entry.sha256) issues.push(`${entry.file}: protected migration was removed or edited`);
    if (!applied.has(entry.file.split('_')[0]) && entry.prodStatus !== 'approved') issues.push(`${entry.file}: ${entry.reason}`);
  }
  for (const file of Object.keys(files)) {
    if (file >= '20261030000000' && !classified.has(file) && !applied.has(file.split('_')[0])) issues.push(`${file}: new migration has no production release classification`);
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
    const issues = auditAuthRelease(policy, files, JSON.parse(readFileSync(versionsFile, 'utf8')));
    if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
    else console.log('Auth migration preflight passed for the supplied target ledger; this is not deployment approval.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}