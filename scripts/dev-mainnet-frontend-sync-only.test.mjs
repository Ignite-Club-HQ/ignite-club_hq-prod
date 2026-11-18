import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = new URL('../.github/workflows/deploy-frontend-canister.yml', import.meta.url);
const engine = new URL('../.github/workflows/deploy-dev-engine-frontend.yml', import.meta.url);
const source = readFileSync(file, 'utf8');

test('existing DEV mainnet frontend does asset-only sync and never deploy/stop/reinstall', () => {
  assert.match(source, /name: "\[TEST\] Deploy web app \(frontend canister\)"/);
  assert.match(source, /icp sync frontend -e ic/);
  assert.doesNotMatch(source, /^\s*icp deploy\s/m);
  assert.doesNotMatch(source, /^\s*icp canister (stop|install|create|settings update|top-up|delete)\b/m);
  assert.doesNotMatch(source, /^\s*icp cycles mint\b/m);
  assert.doesNotMatch(source, /^\s*git push\b/m);
  assert.match(source, /permissions:\s*\n\s*contents: read/);
});

test('fail-closed readback pins original live frontend, module, controllers and cycles', () => {
  assert.match(source, /EXPECTED_FRONTEND="proe7-kqaaa-aaaas-qg6gq-cai"/);
  assert.match(source, /EXPECTED_MODULE_HASH="0xb143d5526d180140593e8d61f1eca2d917d5761cf0b59fdc5bada947abb1d304"/);
  assert.match(source, /status\.status !== 'Running'/);
  for (const principal of ['jfagr-a4uwo-nlikz-ysri5-ipbrt-k4qa2-vkofo-it7lz-eha3w-4wix6-oqe',
    'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae',
    'mzzzv-taaaa-aaaal-qxlrq-cai']) assert.ok(source.includes(principal));
  assert.match(source, /fuel < 200_000_000_000n/);
  assert.match(source, /FINAL_STATUS/);
  assert.match(source, /GITHUB_STEP_SUMMARY/);
});

test('original DEV mainnet routing remains on and Cloud Engine release remains held', () => {
  assert.match(source, /push:\s*\n\s*branches: \[main\]/);
  assert.match(source, /frontend\/\*\*/);
  assert.match(source, /IGNITE_ICP_ENV=dev/);
  assert.match(source, /IGNITE_MCP_DEV_GROUP2_CHILD_PII_DISCOVERY/);
  assert.match(source, /IGNITE_DEV_SHARED_CLUB_NAMES_RELEASE_READY/);
  assert.doesNotMatch(source, /FRONTEND_CANISTER_ID: 7pfcq-raaaa-aaac5-aabia-cai/);
  const cloud = readFileSync(engine, 'utf8');
  const triggers = cloud.slice(0, cloud.indexOf('concurrency:'));
  assert.doesNotMatch(triggers, /^\s*push:/m);
  assert.match(cloud, /vars\.IGNITE_DEV_ENGINE_RELEASE_READY == 'true'/);
});
