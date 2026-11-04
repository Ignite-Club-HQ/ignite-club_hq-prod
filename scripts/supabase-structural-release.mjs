import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditAuthMigrationPlan } from './auth-release-preflight.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROD_REF = 'yabcfiuntwqjwvschnji';
export const hash = value => createHash('sha256').update(value).digest('hex');

export function planRelease(policy, files, ledger, heldSources = {}) {
  if (!Array.isArray(ledger) || ledger.length > 10000) throw new Error('Bounded live migration ledger required');
  const versions = ledger.map(row => row.version);
  const pending = Object.keys(files).filter(file => !versions.includes(file.split('_')[0])).sort();
  const plan = pending.map(file => ({ file, sha256: hash(files[file]) }));
  // A policy can refer to future main-only sources absent from this branch AND
  // target ledger. Preserve their bytes outside executable migrations; never
  // use this archive to excuse missing applied or modified executable SQL.
  const archivedIssues = [];
  const activePolicy = { ...policy, migrations: policy.migrations.filter(entry => {
    if (Object.hasOwn(files, entry.file) || versions.includes(entry.file.split('_')[0])) return true;
    const archived = heldSources[entry.file];
    if (entry.prodStatus !== 'blocked' || typeof archived !== 'string' || hash(archived) !== entry.sha256) {
      archivedIssues.push(`${entry.file}: absent future source has no fingerprint-matched held archive`);
    }
    return false;
  }) };
  const issues = [...archivedIssues, ...auditAuthMigrationPlan(activePolicy, files, versions, plan)];
  const localVersions = new Set(Object.keys(files).map(file => file.split('_')[0]));
  for (const row of ledger) {
    if (!localVersions.has(row.version)) issues.push(`${row.version}: target history has no source migration; no repair is authorized`);
  }
  return { plan, issues };
}

export function selectFunctions(changedPaths, available) {
  if (changedPaths.some(file => file === 'supabase/config.toml' || file.startsWith('supabase/functions/_shared/'))) return [...available].sort();
  const names = [...new Set(changedPaths.filter(file => file.startsWith('supabase/functions/')).map(file => file.split('/')[2]))];
  if (names.some(name => !available.includes(name))) throw new Error('Deleted or unknown function requires separate review; no deletion is authorized');
  return names.sort();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed; release stopped (no retry or repair)`);
  return result.stdout;
}

function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/prod' || process.env.PROJECT_REF !== PROD_REF) throw new Error('Exact PROD branch and database required');
  for (const key of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'GITHUB_SHA']) {
    if (!process.env[key]) throw new Error(`${key} is required`);
  }
  const output = process.env.RELEASE_REPORT_DIR || path.join(process.env.RUNNER_TEMP || '/tmp', 'supabase-structural-release');
  mkdirSync(output, { recursive: true });
  const files = Object.fromEntries(readdirSync(path.join(root, 'supabase/migrations')).filter(file => file.endsWith('.sql')).map(file => [file, readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')]));
  const policy = JSON.parse(readFileSync(path.join(root, 'scripts/auth-release-policy.json'), 'utf8'));
  // This connection is read-only for evidence. No DEV connection exists here.
  const connection = `postgresql://postgres@db.${PROD_REF}.supabase.co:5432/postgres?sslmode=require&connect_timeout=10`;
  const ledger = JSON.parse(run('psql', [connection, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT coalesce(json_agg(x ORDER BY version), '[]'::json) FROM (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version LIMIT 10001) x"], {
    env: { ...process.env, PGPASSWORD: process.env.SUPABASE_DB_PASSWORD, PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000' },
  }));
  const heldSources = JSON.parse(readFileSync(path.join(root, 'scripts/structural-held-sources.json'), 'utf8'));
  const { plan, issues } = planRelease(policy, files, ledger, heldSources);
  const pendingFiles = Object.fromEntries(plan.map(entry => [entry.file, files[entry.file]]));
  const sqlCheck = spawnSync('python3', ['scripts/structural-sql-check.py'], { cwd: root, input: JSON.stringify(pendingFiles), encoding: 'utf8' });
  if (sqlCheck.error || ![0, 1].includes(sqlCheck.status)) issues.push('SQL parser unavailable; release held');
  else {
    try { issues.push(...JSON.parse(sqlCheck.stdout)); } catch { issues.push('SQL inspection result unreadable; release held'); }
  }
  const before = process.env.RELEASE_BEFORE;
  if (!before || !/^[a-f0-9]{40}$/.test(before)) issues.push('Exact function comparison commit required');
  const available = readdirSync(path.join(root, 'supabase/functions')).filter(name => /^[a-z0-9-]+$/.test(name) && existsSync(path.join(root, 'supabase/functions', name, 'index.ts')));
  const changed = before && /^[a-f0-9]{40}$/.test(before) ? run('git', ['diff', '--name-only', before, process.env.GITHUB_SHA, '--', 'supabase/functions', 'supabase/config.toml']).trim().split('\n').filter(Boolean) : [];
  const functions = selectFunctions(changed, available);
  // These recovered privileged handlers remain held by the existing review.
  for (const name of functions) {
    if (['auto-rsvp-push-cron', 'chat-photo-gallery-reminders'].includes(name)) issues.push(`${name}: recovered privileged handler requires independent authorization review`);
  }
  const report = { commit: process.env.GITHUB_SHA, project: PROD_REF, phase: 'checked', plan, functions, issues, dataCopy: false };
  const save = () => writeFileSync(path.join(output, 'release-report.json'), JSON.stringify(report, null, 2));
  save();
  if (issues.length) {
    console.error(issues.join('\n'));
    throw new Error('Structural-only release held before ALL writes; see release report');
  }
  run('supabase', ['link', '--project-ref', PROD_REF], { stdio: 'inherit' });
  // Full checked source inventory only: no filtered tree, repair or include-all.
  if (plan.length) run('supabase', ['db', 'push', '--linked', '--yes'], { stdio: 'inherit' });
  report.phase = 'schema-applied'; save();
  for (const name of functions) {
    run('supabase', ['functions', 'deploy', name, '--project-ref', PROD_REF], { stdio: 'inherit' });
  }
  report.phase = 'complete'; save();
  console.log(`Structural-only release complete: ${plan.length} migrations, ${functions.length} function deployments; no data copy or operational repairs.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}