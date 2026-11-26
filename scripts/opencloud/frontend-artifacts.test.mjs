import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inventoryFrontend } from './frontend-artifacts.mjs';
test('frontend artifacts refuse known mainnet IDs rather than remapping authorization pins', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'opencloud-artifact-'));
  try {
    writeFileSync(path.join(folder, 'app.js'), 'const identity="mq2sj-fiaaa-aaaal-qxlqa-cai";');
    assert.throws(() => inventoryFrontend(folder, new Set(['mq2sj-fiaaa-aaaal-qxlqa-cai'])), /existing deployment IDs/);
    writeFileSync(path.join(folder, 'app.js'), 'const identity="h5lly-yyaaa-aaac5-aadqq-cai";');
    const entries = inventoryFrontend(folder, new Set(['mq2sj-fiaaa-aaaal-qxlqa-cai']));
    assert.equal(entries.length, 1); assert.ok(entries[0].bytes > 0); assert.equal(entries[0].sha256.length, 64);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});