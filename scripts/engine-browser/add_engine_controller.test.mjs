import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENGINE_OWNER, DEV_GOVERNOR, WEB_APP_KEY } from './engine-controller-policy.mjs';
import { ENGINE_FRONTEND } from '../dev-engine-frontend-policy.mjs';

const script = readFileSync(new URL('./add_engine_controller.sh', import.meta.url), 'utf8');
const group2 = JSON.parse(readFileSync(new URL('../../docs/dev-engine-group2-owner-inventory.json', import.meta.url))).canisterIds;
const PRINCIPAL = /^[a-z0-9]{5}(?:-[a-z0-9]{5}){2,}(?:-[a-z0-9]{2,3})?-cai$/;

function listedIds() {
  return [...script.matchAll(/^\s*"([a-z0-9-]+-cai)\|/gm)].map((m) => m[1]);
}

test('owner guard pins the OpenCloud owner identity and fails closed', () => {
  assert.match(script, /^set -euo pipefail$/m);
  assert.equal(script.match(/^EXPECTED_OWNER="(.+)"$/m)[1], ENGINE_OWNER);
  assert.equal(script.match(/^DEV_GOVERNOR="(.+)"$/m)[1], DEV_GOVERNOR);
  assert.equal(script.match(/^WEB_APP_KEY="(.+)"$/m)[1], WEB_APP_KEY);
  assert.match(script, /if \[ "\$\{ACTUAL\}" != "\$\{EXPECTED_OWNER\}" \]; then[\s\S]*?exit 1\nfi/);
});

test('exactly the 32 engine parts are listed, unique and well-formed', () => {
  const ids = listedIds();
  assert.equal(ids.length, 32, 'one entry per engine part');
  assert.equal(new Set(ids).size, 32, 'no duplicate canister ids');
  for (const id of ids) assert.ok(PRINCIPAL.test(id), `bad principal ${id}`);
  assert.ok(ids.includes(ENGINE_FRONTEND), 'the website part must be listed');
  for (const id of Object.values(group2)) assert.ok(ids.includes(id), `missing Group 2 id ${id}`);
});

test('the DEV governor is added to every part and the owner is never removed', () => {
  assert.equal(
    (script.match(/--add-controller "\$\{DEV_GOVERNOR\}"/g) || []).length, 1,
    'one governor add loop covers all listed parts',
  );
  assert.match(script, /for entry in "\$\{CANISTERS\[@\]\}"; do[\s\S]*?--add-controller "\$\{DEV_GOVERNOR\}"/);
  assert.ok(!script.includes('--remove-controller'), 'must never remove a controller');
  assert.ok(!script.includes('--remove-all-controllers'), 'must never clear the controller list');
});

test('the publishing key controls only the website part', () => {
  const adds = [...script.matchAll(/icp canister settings update "([^"]+)"\s*\\\s*\n\s*--add-controller "\$\{WEB_APP_KEY\}"/g)];
  assert.equal(adds.length, 1, 'exactly one publishing-key add');
  assert.equal(adds[0][1], '${FRONTEND}');
  assert.equal(script.match(/^FRONTEND="(.+)"$/m)[1], ENGINE_FRONTEND);
});

test('website upload permissions are granted to both update keys', () => {
  assert.match(script, /for key in "\$\{DEV_GOVERNOR\}" "\$\{WEB_APP_KEY\}"; do/);
  assert.match(script, /for permission in Prepare Commit; do/);
  assert.match(
    script,
    /icp canister call "\$\{FRONTEND\}" grant_permission\s*\\\s*\n\s*"\(record \{ to_principal = principal \\"\$\{key\}\\"; permission = variant \{ \$\{permission\} \} \}\)" \\/,
    'the grant call must target the website part with the looped key and permission',
  );
});

test('every part is read back before the run claims success', () => {
  assert.match(script, /icp canister status "\$\{id\}" --network ic 2>\/dev\/null \| grep -q "\$\{DEV_GOVERNOR\}"/);
  assert.match(script, /icp canister status "\$\{FRONTEND\}" --network ic 2>\/dev\/null \| grep -q "\$\{WEB_APP_KEY\}"/);
  assert.match(script, /if \[ "\$\{FAILED\}" -ne 0 \]; then[\s\S]*?exit 1\nfi/);
});
