/** Explicit offline artifact command. It never invokes deploy, sync, CI or a signing tool. */
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ensureFrontendDeps } from '../ensure-frontend-deps.mjs';
import { ROOT, frontendEnv, validate, mainnetIds } from './deployment.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function inventoryFrontend(directory, forbidden = mainnetIds()) {
  const entries = [];
  const visit = folder => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error('Artifact symlinks forbidden');
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        const bytes = readFileSync(file);
        if (/\.(html|js|json|txt)$/.test(entry.name)) {
          const text = bytes.toString('utf8');
          const leaked = [...forbidden].filter(id => text.includes(id));
          if (leaked.length) throw Error(`Artifact contains existing deployment IDs: ${path.relative(directory, file)}; engine-specific compatibility work required`);
        }
        entries.push({ path: path.relative(directory, file), bytes: statSync(file).size, sha256: hash(bytes) });
      }
    }
  };
  visit(directory); return entries.sort((a, b) => a.path.localeCompare(b.path));
}
export function buildFrontend(workDirectory, peerConfig) {
  const work = path.resolve(workDirectory);
  if (!work.startsWith(path.join(ROOT, 'deploy/opencloud/work') + path.sep)) throw Error('Isolated work directory required');
  const config = JSON.parse(readFileSync(path.join(work, 'config.json'), 'utf8'));
  if (config.environment !== 'opencloud-dev') throw Error('PROD remains inactive');
  validate(config, peerConfig);
  ensureFrontendDeps();
  const frontend = path.join(ROOT, 'frontend');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(IGNITE_|VITE_|PUBLIC_CANISTER_ID)/.test(key)));
  Object.assign(env, frontendEnv(config), {
    IGNITE_CANISTER_SOURCE_DIR: path.join(work, 'frontend-dist'),
    IGNITE_CANISTER_OUTPUT_DIR: path.join(work, 'frontend-assets'),
  });
  const run = (cmd, args) => {
    const result = spawnSync(cmd, args, { cwd: frontend, env, stdio: 'inherit' });
    if (result.status !== 0) throw Error('Isolated frontend artifact build failed');
  };
  run(path.join(frontend, 'node_modules/.bin/vite'), ['build', '--config', 'vite.live.config.ts', '--outDir', env.IGNITE_CANISTER_SOURCE_DIR]);
  const html = path.join(env.IGNITE_CANISTER_SOURCE_DIR, 'live-index.html');
  if (!existsSync(html)) throw Error('Built application entry missing');
  cpSync(html, path.join(env.IGNITE_CANISTER_SOURCE_DIR, 'index.html'));
  run(process.execPath, ['scripts/prepare-canister-dist.mjs']);
  const files = inventoryFrontend(env.IGNITE_CANISTER_OUTPUT_DIR);
  writeFileSync(path.join(work, 'frontend-artifacts.json'), JSON.stringify({ environment: config.environment, files,
    installed: false, assetUploadRequired: true, routingApproved: false }, null, 2) + '\n');
  return files;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , directory, peerFile] = process.argv;
  if (!directory || !peerFile) throw Error('Usage: frontend-artifacts.mjs <work-dir> <prod-config.json>');
  buildFrontend(directory, JSON.parse(readFileSync(peerFile, 'utf8')));
  console.log('DEV frontend files inventoried; no install/upload/admission performed');
}