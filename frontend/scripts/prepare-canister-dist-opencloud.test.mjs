import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { frontendEnv, inventory } from '../../scripts/opencloud/deployment.mjs';
const config = JSON.parse(readFileSync(new URL('../../deploy/opencloud/dev.json', import.meta.url), 'utf8'));
test('engine assistant declarations and sign-in callbacks contain only the 32-part engine deployment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opencloud-web-files-'));
  const src = join(dir, 'src'), out = join(dir, 'out'); mkdirSync(src); writeFileSync(join(src, 'index.html'), '<html></html>');
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('./prepare-canister-dist.mjs', import.meta.url))], {
      env: { PATH: process.env.PATH, ...frontendEnv(config), IGNITE_CANISTER_SOURCE_DIR: src, IGNITE_CANISTER_OUTPUT_DIR: out }, stdio: 'pipe',
    });
    const wk = join(out, '.well-known');
    assert.equal(readFileSync(join(wk, 'ii-derivation-origin'), 'utf8').trim(), `https://${config.shared.frontend}.icp.net`);
    assert.deepEqual(JSON.parse(readFileSync(join(wk, 'ii-alternative-origins'), 'utf8')).alternativeOrigins, [`https://${config.shared.frontend}.icp.net`]);
    const manifest = JSON.parse(readFileSync(join(wk, 'ic-architecture'), 'utf8'));
    const ids = new Set(inventory(config).map(r => r.id));
    for (const row of manifest.canisters) assert.ok(ids.has(row.id), row.id);
    assert.ok(manifest.canisters.some(r => r.id === config.groups[1].canisterIds.pii_access_control));
    assert.ok(!readFileSync(join(wk, 'ii-auth-callbacks'), 'utf8').includes('igniteclubhq.app'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});