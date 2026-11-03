#!/usr/bin/env node
// Promote the canister layer from the development repository into the live
// repository, add-only, and stop there.
//
// Why this exists: the live repository is a different, older layout, and its
// canister set cannot be created until the canister sources, the live
// environment definition and the release tooling exist inside it. Copying a
// whole tree would overwrite live code, so this runner only ever adds files the
// live repository does not have, from the allowlist in
// scripts/icp-promotion-manifest.mjs, and reports every file it left alone.
//
// Safety:
//   - the destination is fixed to the live repository's `prod` branch and
//     refuses anything else, including `main`;
//   - a source checkout with manifest holes is refused, so the live repository
//     never receives a canister layer it cannot build;
//   - a file that already exists with different content is a conflict: the run
//     stops unless the operator explicitly passes --allow-drift;
//   - the commit message carries [skip ci] so no release automation starts;
//   - plan (default) writes nothing at all.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROD_REPO,
  PROD_BRANCH,
  SOURCE_BRANCH,
  promotionFiles,
  missingSourceEntries,
  assertPromotionTarget,
  filesToWrite,
  historicalSourceFiles,

} from './icp-promotion-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flagValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const apply = args.includes('--apply');
const allowDrift = args.includes('--allow-drift');
const dest = flagValue('--dest') ?? PROD_REPO;
const branch = flagValue('--branch') ?? PROD_BRANCH;
const sourceRef = flagValue('--source-ref');
const token = process.env.MIGRATION_GITHUB_TOKEN ?? '';

const die = (message) => {
  console.error(`\n::error::${message}`);
  process.exit(1);
};

async function api(method, route, body) {
  const res = await fetch(`https://api.github.com${route}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function trackedFiles() {
  if (sourceRef) return execFileSync('git', ['ls-tree', '-r', '--name-only', sourceRef], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  // git ls-files sees tracked files only, so generated output and dependencies
  // (untracked by definition here) can never be proposed for copying.
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function localContent(file) {
  const buffer = sourceRef ? execFileSync('git', ['show', `${sourceRef}:${file}`], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 }) : readFileSync(path.join(ROOT, file));
  const text = buffer.toString('utf8');
  // The tree API carries file bodies inline as text: a file that is not valid
  // UTF-8 would be corrupted on the way, so the run refuses it instead.
  if (Buffer.from(text, 'utf8').compare(buffer) !== 0) throw new Error(`${file} is not text`);
  return text;
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

async function main() {
  if (!token) die('MIGRATION_GITHUB_TOKEN is not set; nothing can be read or written.');
  try { assertPromotionTarget({ dest, branch }); } catch (error) { die(error.message); }
  if (sourceRef && !/^[a-f0-9]{40}$/.test(sourceRef)) die('Historical source must be an exact 40-character commit SHA.');


  const files = trackedFiles();
  const holes = sourceRef ? ['Cargo.toml', 'Cargo.lock', 'mops.toml', 'mops.lock'].filter((file) => !files.includes(file)) : missingSourceEntries(files);
  if (holes.length) {
    die(`This checkout is missing ${holes.length} manifest entr${holes.length === 1 ? 'y' : 'ies'} (${holes.slice(0, 8).join(', ')}${holes.length > 8 ? ', …' : ''}). Bring the development repository up to date first — promoting a partial layer would leave the live repository unable to build its canisters.`);
  }

  const wanted = sourceRef ? historicalSourceFiles(files) : promotionFiles(files);
  if (sourceRef && !wanted.some((file) => file.startsWith('backend/'))) die('Historical source has no backend code.');
  const head = await api('GET', `/repos/${dest}/git/refs/heads/${branch}`);
  const headSha = head.object.sha;
  const listing = await api('GET', `/repos/${dest}/git/trees/${headSha}?recursive=1`);
  if (listing.truncated) die('The live repository listing came back truncated; refusing to guess what is already there.');
  const existing = new Set(listing.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path));
  const blobHashes = new Map(listing.tree.filter((entry) => entry.type === 'blob').map((entry) => [entry.path, entry.sha]));

  const add = wanted.filter((file) => !existing.has(file));
  const present = wanted.filter((file) => existing.has(file));

  // Bounded: only files that already exist need their bytes compared, and the
  // live repository holds none of the canister sources today.
  const differ = [];
  for (const file of present) {
    const bytes = Buffer.from(localContent(file), 'utf8');
    const localHash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (blobHashes.get(file) !== localHash) differ.push(file);
  }

  console.log(`\n## ICP layer promotion ${apply ? '(applying)' : '(plan only)'}: ${dest}@${branch}`);
  console.log(`Source: ${sourceRef ?? process.env.GITHUB_SHA ?? 'this checkout'} | allowlisted: ${wanted.length} | to add: ${add.length} | already present: ${present.length} | differ: ${differ.length}`);
  if (differ.length) console.log(`\nNot copied — the live repository holds different bytes for:\n  ${differ.join('\n  ')}`);
  if (!add.length) console.log('\nNothing to add: the live repository already holds every allowlisted file.');

  if (!apply) {
    console.log('\nPlan only — nothing was written. Re-run with --apply to create the commit.');
    return;
  }
  const write = filesToWrite({ add, differ, allowDrift });
  if (!write) {
    die(`${differ.length} file(s) differ in the live repository. Copying would overwrite live code; review them, then re-run with --allow-drift if the development versions really should win.`);
  }
  if (!write.length) return;
  if (allowDrift && differ.length) console.log(`\nOverwriting ${differ.length} differing file(s) as requested:\n  ${differ.join('\n  ')}`);

  let treeSha = headSha;
  for (const chunk of chunks(write, 100)) {
    const tree = await api('POST', `/repos/${dest}/git/trees`, {
      base_tree: treeSha,
      tree: chunk.map((file) => ({ path: file, mode: '100644', type: 'blob', content: localContent(file) })),
    });
    treeSha = tree.sha;
    console.log(`Staged ${chunk.length} file(s) (${treeSha.slice(0, 7)}).`);
  }

  const commit = await api('POST', `/repos/${dest}/git/commits`, {
    message: `Promote ICP canister layer from ${sourceRef ?? process.env.GITHUB_SHA ?? SOURCE_BRANCH} [skip ci]`,
    parents: [headSha],
    tree: treeSha,
  });
  // force=false: if the live branch moved while this run was reading it, GitHub
  // rejects the update instead of dropping someone else's commit.
  const ref = await api('PATCH', `/repos/${dest}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
  console.log(`\nWrote ${write.length} file(s) (${add.length} added, ${write.length - add.length} overwritten) to ${dest}@${branch} as ${commit.sha}${ref.object.sha !== commit.sha ? ' (rejected: the live branch moved — re-run the plan)' : ''}.`);
  if (ref.object.sha !== commit.sha) process.exitCode = 1;
}

main().catch((error) => die(error.message));
