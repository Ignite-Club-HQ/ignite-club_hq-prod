import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function verifiedBytes(bytes, digest) {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? '') ||
    `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== digest) {
    throw Error('Pinned build-tool checksum could not be verified');
  }
  return bytes;
}

async function github(path, binary = false) {
  const token = process.env.GH_TOKEN;
  if (!token) throw Error('GitHub build-download authorization unavailable');
  let response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json' },
    redirect: 'manual', signal: AbortSignal.timeout(60000),
  });
  if (binary && response.status === 302) {
    const location = response.headers.get('location');
    if (!location || new URL(location).protocol !== 'https:' || new URL(location).hostname !== 'release-assets.githubusercontent.com') {
      throw Error('Unexpected build-tool download destination');
    }
    // Never forward GitHub credentials to the signed asset host.
    response = await fetch(location, { signal: AbortSignal.timeout(120000) });
  }
  if (!response.ok) throw Error(`Build-tool download failed (${response.status})`);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
}

async function asset(repo, tag, name) {
  const release = await github(`/repos/${repo}/releases/tags/${tag}`);
  const entry = release.assets.find(a => a.name === name);
  if (!entry || !entry.digest) throw Error('Exact build-tool asset or checksum missing');
  const bytes = await github(`/repos/${repo}/releases/assets/${entry.id}`, true);
  if (bytes.length !== entry.size) throw Error('Incomplete build-tool download');
  return { bytes: verifiedBytes(bytes, entry.digest), hash: entry.digest.slice(7) };
}

export async function prefetch() {
  if (process.env.GITHUB_REF !== 'refs/heads/main' || !process.env.ICP_HOME || !process.env.RUNNER_TEMP) {
    throw Error('TEST runner with explicit cache paths required');
  }
  const root = join(process.env.ICP_HOME, 'pkg');
  await mkdir(root, { recursive: true });
  let manifest;
  try { manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; manifest = { tags: {} }; }
  for (const [name, version] of [['motoko', 'v5.1.0'], ['rust', 'v3.3.0']]) {
    const { bytes, hash } = await asset('dfinity/icp-cli-recipes', `${name}-${version}`, 'recipe.hbs');
    const dir = join(root, 'recipes', hash);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'recipe.hbs'), bytes);
    manifest.tags[`recipe@dfinity/${name}:${version}`] = hash;
  }
  await writeFile(join(root, 'manifest.json.tmp'), JSON.stringify(manifest));
  await rename(join(root, 'manifest.json.tmp'), join(root, 'manifest.json'));
  for (const version of ['1.14.0', '1.16.1']) {
    const { bytes } = await asset('caffeinelabs/motoko', version, `motoko-Linux-x86_64-${version}.tar.gz`);
    const archive = join(process.env.RUNNER_TEMP, `moc-${version}.tar.gz`);
    const dir = join(homedir(), '.cache', 'mops', 'moc', version);
    await mkdir(dir, { recursive: true });
    await writeFile(archive, bytes);
    const result = spawnSync('tar', ['-xzf', archive, '-C', dir, 'moc'], { stdio: 'inherit' });
    await rm(archive);
    if (result.status !== 0) throw Error('Compiler extraction failed');
    const check = spawnSync(join(dir, 'moc'), ['--version'], { encoding: 'utf8' });
    if (check.status !== 0 || !check.stdout.includes(version)) throw Error('Compiler version mismatch');
  }
  console.log('Exact TEST recipes and compiler versions downloaded and checksum verified');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prefetch().catch(error => { console.error(error.message); process.exitCode = 1; });
}