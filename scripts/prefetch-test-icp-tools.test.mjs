import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifiedBytes, prefetch, extractCompiler } from './prefetch-test-icp-tools.mjs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const member of ['moc', './moc']) {
  test(`extracts the compiler from a verified archive member ${member}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'compiler-extract-'));
    try {
      const source = join(root, 'source'); await mkdir(source);
      await writeFile(join(source, 'moc'), 'fixture compiler bytes');
      const archive = join(root, 'compiler.tar.gz');
      assert.equal(spawnSync('tar', ['-czf', archive, '-C', source, member]).status, 0);
      // Reproduces the former CI failure for the official ./moc layout.
      if (member === './moc') assert.notEqual(spawnSync('tar', ['-xOzf', archive, 'moc']).status, 0);
      await extractCompiler(archive, join(root, 'cache'));
      assert.equal(await readFile(join(root, 'cache', 'moc'), 'utf8'), 'fixture compiler bytes');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test('rejects nested compiler paths without extracting them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compiler-extract-'));
  try {
    await mkdir(join(root, 'nested')); await writeFile(join(root, 'nested', 'moc'), 'wrong layout');
    const archive = join(root, 'compiler.tar.gz');
    assert.equal(spawnSync('tar', ['-czf', archive, '-C', root, 'nested/moc']).status, 0);
    await assert.rejects(extractCompiler(archive, join(root, 'cache')), /exactly one root moc/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('accepts exact bytes and refuses changed or missing checksums', () => {
  const bytes = Buffer.from('pinned recipe');
  const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  assert.equal(verifiedBytes(bytes, hash), bytes);
  assert.throws(() => verifiedBytes(Buffer.from('different recipe'), hash));
  assert.throws(() => verifiedBytes(bytes, undefined));
});

test('refuses PROD execution before any download or cache mutation', async () => {
  const previous = process.env.GITHUB_REF;
  process.env.GITHUB_REF = 'refs/heads/prod';
  try { await assert.rejects(prefetch(), /TEST runner/); }
  finally { if (previous === undefined) delete process.env.GITHUB_REF; else process.env.GITHUB_REF = previous; }
});