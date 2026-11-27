import { ENVIRONMENTS, assertIsolated, loadIds } from './icp-environments.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { buildFrontend } from './opencloud/frontend-artifacts.mjs';
import { verifyProdPublication } from './prod-publication-gate.mjs';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';

// A PROD site with a missing or partial service table would silently talk to nothing.
export function assertProdIdsComplete(ids, expected = PROD_CHECK_IDS) {
  for (const [name, id] of Object.entries(expected)) {
    if (ids[name] !== id) throw new Error(`PROD hosting build is missing or has the wrong ${name} service ID; publication must stop`);
  }
  return ids;
}

// The prod branch keeps its own routing snapshot; a merge that brings DEV's copy
// would make the live site reject PROD's router, so the build refuses it.
export function assertProdRoutingSnapshot(source, expected = PROD_CHECK_IDS) {
  const router = /"routerCanisterId":\s*"([^"]+)"/.exec(source)?.[1];
  if (router !== expected.shard_router || !/"approved":\s*true/.test(source)) throw new Error('PROD hosting build has no approved PROD routing snapshot; publication must stop');
  return router;
}


export function resolveHostBuildEnv(env) {
  const branch = env.BRANCH || env.CM_BRANCH || env.GITHUB_REF_NAME;
  const production = env.CONTEXT === 'production' || env.IGNITE_ICP_ENV === 'prod';
  if (production && branch !== 'prod') throw new Error('Production hosting must build only the prod branch');
  const target = branch === 'prod' ? 'prod' : 'dev';
  const expected = `https://${ENVIRONMENTS[target].supabaseRef}.supabase.co`;
  const urls = [env.IGNITE_LIVE_SUPABASE_URL, env.VITE_SUPABASE_URL, env.SUPABASE_URL].filter(Boolean);
  if (urls.some(url => url.replace(/\/$/, '') !== expected)) throw new Error('Conflicting hosting database; scope variables separately for main and prod');
  const keyNames = ['IGNITE_LIVE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'];
  const configured = keyNames.filter(name => env[name]);
  if (!configured.length) throw new Error(`Missing public hosting key: set IGNITE_LIVE_SUPABASE_ANON_KEY to the ${target.toUpperCase()} public key in the build environment`);
  const key = env[configured[0]];
  // Codemagic explicitly exports the retained PROD key before this check.
  // Other aliases are not inputs to that build; validate the selected key below.
  const codemagicCanonical = Boolean(env.CM_BUILD_ID && target === 'prod' && env.IGNITE_LIVE_SUPABASE_ANON_KEY);
  if (!codemagicCanonical && configured.some(name => env[name] !== key)) {
    throw new Error(`Conflicting public hosting key settings: ${configured.join(', ')}. Keep IGNITE_LIVE_SUPABASE_ANON_KEY as the ${target.toUpperCase()} public key and remove duplicate key variables from the build environment (Codemagic: supabase_prod and application/team variables). Do not use a private key.`);
  }
  if (!key.startsWith('sb_publishable_')) {
    let payload;
    try { payload = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString()); }
    catch { throw new Error('Public publishable or anon key required'); }
    if (payload.role !== 'anon' || payload.ref !== ENVIRONMENTS[target].supabaseRef) throw new Error('Hosting key is private or belongs to another database');
  }
  return { ...env, IGNITE_ICP_ENV: target, IGNITE_LIVE_SUPABASE_URL: expected, IGNITE_LIVE_SUPABASE_ANON_KEY: key };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = resolveHostBuildEnv(process.env);
    if (env.IGNITE_ICP_ENV === 'prod') await verifyProdPublication(env, { waitMs: 12 * 60 * 1000 });
    if (env.IGNITE_ICP_ENV === 'prod' && env.IGNITE_PROD_PUBLICATION_TARGET === 'opencloud') {
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
      const workRoot = path.join(root, 'deploy/opencloud/work');
      mkdirSync(workRoot, { recursive: true });
      const work = mkdtempSync(path.join(workRoot, 'netlify-prod-'));
      try {
        cpSync(path.join(root, 'deploy/opencloud/prod.json'), path.join(work, 'config.json'));
        process.env.OPENCLOUD_PROD_OFFLINE_BUILD = 'true';
        process.env.SUPABASE_URL = env.IGNITE_LIVE_SUPABASE_URL;
        process.env.SUPABASE_PUBLISHABLE_KEY = env.IGNITE_LIVE_SUPABASE_ANON_KEY;
        buildFrontend(work, JSON.parse(readFileSync(path.join(root, 'deploy/opencloud/dev.json'), 'utf8')));
        const output = path.join(root, 'frontend/dist-live');
        rmSync(output, { recursive: true, force: true });
        cpSync(path.join(work, 'frontend-assets'), output, { recursive: true });
      } finally { rmSync(work, { recursive: true, force: true }); }
    } else {
    const ids = assertIsolated(env.IGNITE_ICP_ENV, loadIds(env.IGNITE_ICP_ENV));
    if (env.IGNITE_ICP_ENV === 'prod') {
      assertProdIdsComplete(ids);
      assertProdRoutingSnapshot(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend/src/live/generated/routingGates.ts'), 'utf8'));
    }
    env.IGNITE_LIVE_ICP_CANISTER_IDS_JSON = JSON.stringify(ids);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    for (const [command, args, cwd] of [
      [process.execPath, ['scripts/ensure-frontend-deps.mjs'], root],
      [process.execPath, ['scripts/sync-canister-ids.mjs'], root],
      ['npm', ['run', 'build:live'], path.join(root, 'frontend')],
    ]) {
      const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
      if (result.status !== 0 || result.error) throw new Error('Hosting build failed; publication must stop');
    }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}