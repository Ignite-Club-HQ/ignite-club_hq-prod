import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateProdPushConfig, runProdPush } from './prod-push-config.mjs';

const prod = { notification_queue: 'prod-queue' }, dev = { notification_queue: 'dev-queue' };
const parse = id => ({ toText: () => id });
const env = {
  GITHUB_REF: 'refs/heads/prod', IGNITE_ICP_ENV: 'prod', PROD_ICP_PUSH_ENABLED: 'true',
  PROD_ICP_PUSH_QUEUE_IDS_JSON: '["prod-queue"]', PROD_ICP_PUSH_WORKER_SEED: 'a'.repeat(64),
  PROD_FIREBASE_PROJECT_ID: 'prod-firebase',
  PROD_FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'prod-firebase', client_email: 'synthetic@example.invalid', private_key: 'synthetic' }),
};
test('approved PROD config selects only the provisioned PROD queue', () => {
  assert.deepEqual(validateProdPushConfig(env, prod, dev, parse), { directory: 'prod-queue', queues: ['prod-queue'] });
});
for (const [name, changes] of [
  ['main branch', { GITHUB_REF: 'refs/heads/main' }],
  ['DEV environment', { IGNITE_ICP_ENV: 'dev' }],
  ['disabled activation', { PROD_ICP_PUSH_ENABLED: 'false' }],
  ['empty inventory', { PROD_ICP_PUSH_QUEUE_IDS_JSON: '' }],
  ['DEV queue', { PROD_ICP_PUSH_QUEUE_IDS_JSON: '["dev-queue"]' }],
  ['duplicate queue', { PROD_ICP_PUSH_QUEUE_IDS_JSON: '["prod-queue","prod-queue"]' }],
  ['unexpected queue', { PROD_ICP_PUSH_QUEUE_IDS_JSON: '["prod-queue","extra"]' }],
  ['missing identity', { PROD_ICP_PUSH_WORKER_SEED: '' }],
  ['wrong Firebase project', { PROD_FIREBASE_PROJECT_ID: 'dev-firebase' }],
]) test(`rejects ${name}`, () => assert.throws(() => validateProdPushConfig({ ...env, ...changes }, prod, dev, parse)));
test('missing or shared PROD mapping is refused', () => {
  assert.throws(() => validateProdPushConfig(env, {}, dev, parse));
  assert.throws(() => validateProdPushConfig(env, prod, prod, parse));
});
test('invalid config never starts delivery; valid config forwards only PROD bindings', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'push-config-'));
  try {
    for (const [dir, ids] of [['prod', prod], ['mainnet', dev]]) {
      const folder = path.join(root, 'deploy', dir, '.icp/data/mappings');
      mkdirSync(folder, { recursive: true }); writeFileSync(path.join(folder, 'ic.ids.json'), JSON.stringify(ids));
    }
    let calls = 0;
    const deliver = async config => { calls++; assert.equal(config.NOTIFICATION_QUEUE_CANISTER_ID, 'prod-queue'); assert.equal(config.FCM_SERVICE_ACCOUNT_JSON, env.PROD_FCM_SERVICE_ACCOUNT_JSON); };
    await assert.rejects(runProdPush({ ...env, GITHUB_REF: 'refs/heads/main' }, parse, deliver, root));
    assert.equal(calls, 0);
    await runProdPush(env, parse, deliver, root); assert.equal(calls, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});