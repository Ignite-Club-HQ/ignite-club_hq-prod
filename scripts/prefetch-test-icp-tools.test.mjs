import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifiedBytes, prefetch } from './prefetch-test-icp-tools.mjs';

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