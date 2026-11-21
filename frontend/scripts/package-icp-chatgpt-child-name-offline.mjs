#!/usr/bin/env node
/**
 * Offline-only packaging for ChatGPT's trusted Node runtime.
 * Copies the EXACT dependency versions already installed by frontend/npm ci,
 * using the checked-in package-lock inventory. NO npm install, network,
 * credentials, private names, deployment or canister calls happen here.
 *
 * Usage: node scripts/package-icp-chatgpt-child-name-offline.mjs /tmp/empty-output-dir
 * Keep output outside the repository. CI uses only synthetic data.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(root, '..');
const destination = process.argv[2] ? resolve(process.argv[2]) : '';
if (!destination || !isAbsolute(destination) ||
    destination === repoRoot || destination.startsWith(repoRoot + sep) ||
    destination === resolve('/') || destination === resolve('/tmp')) {
  throw Error('Offline package destination must be a dedicated directory outside the repository');
}
if (existsSync(destination) && readdirSync(destination).length) {
  throw Error('Offline package output directory must be empty');
}

const locked = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const modules = join(root, 'node_modules');
const validName = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const pending = ['@icp-sdk/core', '@icp-sdk/vetkeys'];
const copied = new Set();

mkdirSync(join(destination, 'scripts'), { recursive:true });
for (const file of [
  'prepare-icp-chatgpt-child-name.mjs',
  'prepare-icp-chatgpt-child-name-connector.mjs',
  'prepare-icp-chatgpt-child-name-cli.mjs',
  'prepare-icp-chatgpt-private-name.mjs',
  'prepare-icp-chatgpt-profile-name-connector.mjs',
  'prepare-icp-chatgpt-profile-name-cli.mjs',
]) {
  cpSync(join(root, 'scripts', file), join(destination, 'scripts', file));
}
while (pending.length) {
  const name = pending.shift();
  if (copied.has(name)) continue;
  if (!validName.test(name)) throw Error('Unexpected package name in runtime dependency lock');
  const row = locked.packages?.['node_modules/' + name];
  const from = join(modules, name);
  if (!row?.version || !existsSync(from)) throw Error('Missing pinned installed ICP runtime dependency');
  const to = join(destination, 'node_modules', name);
  mkdirSync(dirname(to), { recursive:true });
  cpSync(from, to, {recursive:true,force:false,errorOnExist:true});
  copied.add(name);
  for (const child of Object.keys(row.dependencies ?? {})) pending.push(child);
  // Optional dependencies are omitted only when not installed in the pinned
  // frontend package tree; missing optional packages must not be invented.
  for (const child of Object.keys(row.optionalDependencies ?? {})) {
    if (existsSync(join(modules, child))) pending.push(child);
  }
}
writeFileSync(join(destination, 'package.json'),
  JSON.stringify({private:true,type:'module',name:'ignite-dev-chatgpt-offline-private-names'},null,2)+'\n');
writeFileSync(join(destination, 'README.txt'),
  'DEV-only offline child and own-profile name cipher preparation.\n' +
  'Use the child-name or profile-name CLI with ONE private JSON input on stdin.\n' +
  'Never send personal names to GitHub Actions or save them in the repository.\n' +
  'No canister calls or Internet Identity keys are included in this package.\n');
// Report package names only; no personal information or ciphertext is used.
console.log('Prepared pinned offline encryption runtime with ' + copied.size + ' packages.');
