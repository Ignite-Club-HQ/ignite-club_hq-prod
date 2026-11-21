import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertEngineFrontendContext, ENGINE_FRONTEND } from './dev-engine-frontend-policy.mjs';
const target = JSON.parse(readFileSync(new URL('../deploy/frontend-engine/target.json', import.meta.url)));
const valid = { branch: 'main', frontend: ENGINE_FRONTEND, database: 'https://ecsdwrarzfexssxtrymj.supabase.co', ids: target.canisterIds };
test('updates exactly the uploaded DEV engine frontend', () => assert.equal(assertEngineFrontendContext(valid), true));
test('never updates from prod', () => assert.throws(() => assertEngineFrontendContext({ ...valid, branch: 'prod' })));
test('never targets a different frontend', () => assert.throws(() => assertEngineFrontendContext({ ...valid, frontend: 'u3mrq-uiaaa-aaaac-bgioq-cai' })));
test('never uses the production database', () => assert.throws(() => assertEngineFrontendContext({ ...valid, database: 'https://yabcfiuntwqjwvschnji.supabase.co' })));
test('never substitutes another service inventory', () => assert.throws(() => assertEngineFrontendContext({ ...valid, ids: { ...valid.ids, club_domain: 'mzzzv-taaaa-aaaal-qxlrq-cai' } })));

test('unfinished Cloud Engine cannot auto-publish from any main push', () => {
  const engine = readFileSync(new URL('../.github/workflows/deploy-dev-engine-frontend.yml', import.meta.url), 'utf8');
  const trigger = engine.slice(0, engine.indexOf('\nconcurrency:'));
  assert.match(trigger, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(trigger, /^\s*push:/m);
  assert.match(trigger, /confirmation:/);
  const gate = engine.slice(engine.indexOf('jobs:\n  update:'), engine.indexOf('    runs-on: ubuntu-latest'));
  assert.match(gate, /github\.event_name == 'workflow_dispatch'/);
  assert.match(gate, /github\.ref == 'refs\/heads\/main'/);
  assert.match(gate, /vars\.IGNITE_DEV_ENGINE_RELEASE_READY == 'true'/);
  assert.match(gate, /inputs\.confirmation == 'RELEASE DEV ENGINE FRONTEND'/);
});

test('original DEV mainnet frontend deployment remains separately enabled', () => {
  const legacy = readFileSync(new URL('../.github/workflows/deploy-frontend-canister.yml', import.meta.url), 'utf8');
  const trigger = legacy.slice(0, legacy.indexOf('\nconcurrency:'));
  assert.match(trigger, /push:\s*\n\s*branches: \[main\]/);
  assert.match(trigger, /frontend\/\*\*/);
  assert.match(legacy, /IGNITE_ICP_ENV=dev/);
  assert.doesNotMatch(legacy, /deploy\/frontend-prod|IGNITE_ICP_ENV=prod/);
});
