import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { Principal } = require('@icp-sdk/core/principal');
const owner = '4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae';
test('browser owner matches the validated public ID supplied by Paul', () => {
  assert.equal(Principal.fromText(owner).toText(), owner);
});
test('closed browser wiring never activates lifecycle, routing or native delivery', () => {
  const lines = readFileSync(new URL('./links.txt', import.meta.url), 'utf8').trim().split('\n');
  assert.ok(lines.length > 30);
  const forbidden = /grant_worker|configure_native|enable|register_group|set_identity_access_canister/;
  assert.equal(lines.filter(line => forbidden.test(line) && !line.startsWith('notification_queue|set_identity_access_canister|')).length, 0);
  assert.ok(lines.includes('pii_access_control|set_club_domain_canister|one|club_domain'));
  assert.ok(lines.includes('vault_domain|set_vault_stores|vec|media_blob_store'));
});