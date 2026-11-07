import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provisionExistingDevWorker, DEV_WORKER_SECRET } from './icp-dev-push-handover.mjs';
const config = { ref: 'refs/heads/main', confirmation: 'TRANSFER EXISTING TEST PUSH WORKER', seed: 'ab'.repeat(32), accessToken: 'synthetic' };
test('refuses prod and unapproved transfer before network', async () => {
  for (const input of [{ ...config, ref: 'refs/heads/prod' }, { ...config, confirmation: '' }, { ...config, seed: '' }]) {
    let calls = 0;
    await assert.rejects(provisionExistingDevWorker(input, async () => { calls++; }));
    assert.equal(calls, 0);
  }
});
test('transfers only the existing worker to fixed DEV hosting and never enables delivery', async () => {
  const calls = [];
  const result = await provisionExistingDevWorker(config, async (url, opts) => {
    calls.push({ url, opts });
    return new Response(JSON.stringify(calls.length === 1 ? [] : [{ name: DEV_WORKER_SECRET }]));
  });
  assert.deepEqual(result, { transferred: true, deliveryEnabled: false, grantsVerified: false });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url === 'https://api.supabase.com/v1/projects/ecsdwrarzfexssxtrymj/secrets'));
  assert.deepEqual(JSON.parse(calls[1].opts.body), [{ name: DEV_WORKER_SECRET, value: config.seed }]);
});
test('never overwrites an existing hosted worker', async () => {
  let calls = 0;
  await assert.rejects(provisionExistingDevWorker(config, async () => { calls++; return new Response(JSON.stringify([{ name: DEV_WORKER_SECRET }])); }), /refusing overwrite/);
  assert.equal(calls, 1);
});
test('never retries an uncertain write or leaks its credential in the failure', async () => {
  let calls = 0;
  await assert.rejects(provisionExistingDevWorker(config, async () => { calls++; if (calls === 1) return new Response('[]'); throw new Error('transport unavailable'); }));
  assert.equal(calls, 2);
});
test('failed readback is unconfirmed, not permission to write again', async () => {
  let calls = 0;
  await assert.rejects(provisionExistingDevWorker(config, async () => { calls++; return new Response('[]'); }), /unconfirmed/);
  assert.equal(calls, 3);
});