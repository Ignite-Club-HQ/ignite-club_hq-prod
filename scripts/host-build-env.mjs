import { ENVIRONMENTS, assertIsolated, loadIds } from './icp-environments.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyProdPublication } from './prod-publication-gate.mjs';

export function resolveHostBuildEnv(env) {
  const branch = env.BRANCH || env.CM_BRANCH || env.GITHUB_REF_NAME;
  const production = env.CONTEXT === 'production' || env.IGNITE_ICP_ENV === 'prod';
  if (production && branch !== 'prod') throw new Error('Production hosting must build only the prod branch');
  const target = branch === 'prod' ? 'prod' : 'dev';
  const expected = `https://${ENVIRONMENTS[target].supabaseRef}.supabase.co`;
  const urls = [env.IGNITE_LIVE_SUPABASE_URL, env.VITE_SUPABASE_URL, env.SUPABASE_URL].filter(Boolean);
  if (urls.some(url => url.replace(/\/$/, '') !== expected)) throw new Error('Conflicting hosting database; scope variables separately for main and prod');
  const keys = [env.IGNITE_LIVE_SUPABASE_ANON_KEY, env.VITE_SUPABASE_PUBLISHABLE_KEY, env.VITE_SUPABASE_ANON_KEY, env.SUPABASE_PUBLISHABLE_KEY].filter(Boolean);
  if (!keys.length || keys.some(key => key !== keys[0])) throw new Error('Missing or conflicting public hosting key');
  const key = keys[0];
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
    if (env.IGNITE_ICP_ENV === 'prod') await verifyProdPublication(env);
    env.IGNITE_LIVE_ICP_CANISTER_IDS_JSON = JSON.stringify(assertIsolated(env.IGNITE_ICP_ENV, loadIds(env.IGNITE_ICP_ENV)));
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    for (const [command, args, cwd] of [
      [process.execPath, ['scripts/ensure-frontend-deps.mjs'], root],
      [process.execPath, ['scripts/sync-canister-ids.mjs'], root],
      ['npm', ['run', 'build:live'], path.join(root, 'frontend')],
    ]) {
      const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
      if (result.status !== 0 || result.error) throw new Error('Hosting build failed; publication must stop');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}