// OpenCloud DEV automation behind deploy/opencloud/dev.json "activation" (both off by default).
// Plans and runs upgrade-only installs of changed services on the exact 32 DEV targets,
// supplies Lovable preview/Publish settings, and reports the commit and canisters updated.
// Never installs, reinstalls, creates canisters, changes controllers or touches PROD/mainnet.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, validateMappings, frontendEnv, mainnetIds } from './deployment.mjs';
import { UPGRADE_ORDER, canistersForChangedFiles } from '../icp-environments.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = file => JSON.parse(readFileSync(path.resolve(ROOT, file), 'utf8'));
const HASH = /^[a-f0-9]{64}$/;
/** Changes to the staging rules re-pin every module, so they upgrade everything. */
// Management operations must use the authenticated OpenCloud operator relay.
export const MANAGEMENT_PROXY = 's53an-5aaaa-aaac5-aaaaa-cai';
const OPENCLOUD_SHARED = [/^scripts\/opencloud\/deployment\.mjs$/, /^deploy\/opencloud\/dev\.json$/];

export function activation(config) {
  const a = config?.activation ?? {};
  for (const k of Object.keys(a)) if (!['lovableRouting', 'autoDeploy'].includes(k)) throw Error(`Unknown activation switch: ${k}`);
  for (const k of ['lovableRouting', 'autoDeploy']) if (a[k] !== undefined && typeof a[k] !== 'boolean') throw Error(`${k} must be true or false`);
  return { lovableRouting: a.lovableRouting === true, autoDeploy: a.autoDeploy === true };
}

/** Exact DEV-only context: main branch, opencloud-dev, 32 unique IDs, no PROD/mainnet overlap. */
export function guard({ config, peer, branch, forbidden = mainnetIds() }) {
  if (branch !== 'main') throw Error('OpenCloud DEV automation runs from main only');
  if (config?.environment !== 'opencloud-dev' || peer?.environment !== 'opencloud-prod') throw Error('OpenCloud DEV configuration required; PROD is never a target');
  const rows = validateMappings(config, peer, forbidden);
  if (config.operatorId !== MANAGEMENT_PROXY) throw Error('Unexpected OpenCloud management operator');
  if (rows.length !== 32 || rows.some(r => !r.id)) throw Error('Exact 32-canister OpenCloud DEV inventory required');
  return rows;
}

/** Ordered upgrade targets: shared core first, both groups per service, router last; frontend separate. */
export function plan(rows, changedFiles) {
  const files = changedFiles === null ? null : changedFiles;
  let services = canistersForChangedFiles(files);
  if (files && files.some(f => f === 'scripts/opencloud/deployment.mjs')) services = [...UPGRADE_ORDER];
  const targets = [];
  for (const service of UPGRADE_ORDER) {
    if (!services.includes(service)) continue;
    const matches = rows.filter(r => r.service === service);
    if (!matches.length) throw Error(`No OpenCloud DEV target for ${service}`);
    for (const r of matches.sort((a, b) => a.scope.localeCompare(b.scope))) targets.push(r);
  }
  const frontend = files === null || files.some(f => f.startsWith('frontend/') && !/\.(test\.[a-z]+|md)$/.test(f) && !f.startsWith('frontend/scripts/'));
  return { targets, frontend };
}

/** Upgrade-only install arguments from the manifest. Motoko keeps its heap; Rust passes its init record. */
export function upgradeArgs(row, manifestRow, wasmPath, network = 'ic') {
  if (!manifestRow || manifestRow.id !== row.id || manifestRow.service !== row.service || !HASH.test(manifestRow.moduleSha256 ?? '')) throw Error(`Manifest does not match ${row.name}`);
  const args = ['canister', 'install', row.id, '-n', network, '--proxy', MANAGEMENT_PROXY, '--mode', 'upgrade', '--wasm', wasmPath, '-y'];
  if (manifestRow.upgradePersistence === 'keep') args.push('--wasm-memory-persistence', 'keep');
  if (manifestRow.initArgs) args.push('--args', manifestRow.initArgs);
  if (args.some(a => /^(install|reinstall|auto)$/.test(a) && args[args.indexOf(a) - 1] === '--mode')) throw Error('Upgrade mode only');
  return args;
}

/** Lovable preview/Publish settings when routing is switched on; null keeps today's mainnet DEV settings. */
export function previewEnv(config = load('deploy/opencloud/dev.json'), fallbackAnonKey) {
  if (!activation(config).lovableRouting) return null;
  const env = frontendEnv(config);
  env.IGNITE_LIVE_SUPABASE_ANON_KEY ||= fallbackAnonKey;
  env.OPENCLOUD_BUILD_RETIRED_IDS_JSON ||= JSON.stringify([...mainnetIds()]);
  if (!env.IGNITE_LIVE_SUPABASE_ANON_KEY) throw Error('DEV public database key required');
  return env;
}

export function summary({ commit, results, frontend }) {
  const lines = [`### OpenCloud DEV deployment for commit \`${commit}\``, '', '| Canister | ID | Result | Module hash |', '|---|---|---|---|'];
  for (const r of results) lines.push(`| ${r.name} | ${r.id} | ${r.status} | ${r.after ?? r.before ?? ''} |`);
  if (!results.length) lines.push('| (no backend changes) | | | |');
  lines.push('', `Website: ${frontend ?? 'unchanged'}`);
  return lines.join('\n') + '\n';
}

const statusHash = (id, run) => {
  const out = run('icp', ['canister', 'status', id, '-n', 'ic', '--proxy', MANAGEMENT_PROXY, '--json']);
  const hash = /"module_hash"\s*:\s*"?(?:0x)?([a-f0-9]{64})/.exec(out)?.[1];
  if (!hash) throw Error(`Cannot read module hash for ${id}`);
  return hash;
};

/** Sequential upgrade; stops at the first failure, never retries with another mode. */
export function execute({ targets, manifest, work, run }) {
  const results = [];
  for (const row of targets) {
    const m = manifest.canisters.find(c => c.id === row.id);
    const before = statusHash(row.id, run);
    if (before === m.moduleSha256) { results.push({ ...row, status: 'unchanged', before }); continue; }
    try { run('icp', upgradeArgs(row, m, path.join(work, m.wasm))); }
    catch (e) { results.push({ ...row, status: 'failed', before }); return { ok: false, results, error: e.message }; }
    const after = statusHash(row.id, run);
    if (after !== m.moduleSha256) { results.push({ ...row, status: 'hash mismatch', before, after }); return { ok: false, results, error: `Hash mismatch on ${row.name}` }; }
    results.push({ ...row, status: 'upgraded', before, after });
  }
  return { ok: true, results };
}

const shell = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || '').slice(-400)}`);
  return r.stdout;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const config = load('deploy/opencloud/dev.json'), peer = load('deploy/opencloud/prod.json');
  const out = process.env.GITHUB_OUTPUT;
  if (cmd === 'gate') {
    const a = activation(config); const line = `auto_deploy=${a.autoDeploy}\nlovable_routing=${a.lovableRouting}\n`;
    out ? appendFileSync(out, line) : process.stdout.write(line);
  } else if (cmd === 'plan') {
    const rows = guard({ config, peer, branch: process.env.GITHUB_REF_NAME });
    const before = rest[0], after = rest[1];
    let files = null;
    if (before && !/^0+$/.test(before)) files = shell('git', ['diff', '--name-only', before, after]).split('\n').filter(Boolean);
    const p = plan(rows, files);
    writeFileSync(rest[2] ?? 'opencloud-plan.json', JSON.stringify(p, null, 2));
    const line = `backend=${p.targets.length > 0}\nfrontend=${p.frontend}\n`;
    out ? appendFileSync(out, line) : process.stdout.write(line);
  } else if (cmd === 'upgrade') {
    guard({ config, peer, branch: process.env.GITHUB_REF_NAME });
    if (!activation(config).autoDeploy) throw Error('OpenCloud DEV automatic deployment is switched off');
    const [planFile, work] = rest; const p = JSON.parse(readFileSync(planFile, 'utf8'));
    const manifest = JSON.parse(readFileSync(path.join(work, 'manifest.json'), 'utf8'));
    if (manifest.environment !== 'opencloud-dev' || manifest.canisters.length !== 32) throw Error('Wrong manifest');
    const r = execute({ targets: p.targets, manifest, work, run: shell });
    const text = summary({ commit: process.env.GITHUB_SHA, results: r.results, frontend: p.frontend ? 'pending website job' : 'unchanged' });
    process.env.GITHUB_STEP_SUMMARY ? appendFileSync(process.env.GITHUB_STEP_SUMMARY, text) : process.stdout.write(text);
    if (!r.ok) { console.error(`::error::${r.error}. Stopped; nothing was retried or reinstalled.`); process.exit(1); }
  } else { console.error('usage: dev-auto.mjs gate|plan <before> <after> [out]|upgrade <plan> <work>'); process.exit(2); }
}
