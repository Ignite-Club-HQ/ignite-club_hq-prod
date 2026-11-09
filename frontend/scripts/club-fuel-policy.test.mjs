import test from 'node:test';
import assert from 'node:assert/strict';
import { timerCounts, classifyRetry, IDLE_MINUTES, LOW_FUEL_ROUNDS, LOCAL_REPLICA_CONFIG } from './club-fuel-policy.mjs';

test('local replica configuration encodes through the installed PocketIC library', async () => {
  const { createRequire } = await import('node:module');
  const { encodeCreateInstanceRequest } = createRequire(import.meta.url)('@dfinity/pic/dist/pocket-ic-client-types.js');
  const encoded = encodeCreateInstanceRequest(LOCAL_REPLICA_CONFIG);
  assert.equal(encoded.subnet_config_set.application[0].state_config, 'New');
  assert.equal(encoded.subnet_config_set.application[0].cost_schedule, 'Normal');
});

test('twenty idle minutes exercise 40 directory and 20 cleanup callbacks', () => {
  assert.deepEqual(timerCounts(IDLE_MINUTES * 60), { directory: 40n, cleanup: 20n });
  assert.equal(LOW_FUEL_ROUNDS, 80);
});
test('cost amplification is only a candidate, not causal proof', () => {
  assert.equal(classifyRetry([
    { mode: 'timers', before: '100000000', after: '40000000' },
    { mode: 'control', before: '100000000', after: '99000000' },
  ]), 'amplification-candidate-not-proven');
});
test('missing or refused measurements cannot establish absence of retries', () => {
  assert.equal(classifyRetry([{ mode: 'timers', error: 'frozen' }]), 'inconclusive');
});
test('ordinary similar costs do not count as amplified retries', () => {
  assert.equal(classifyRetry([
    { mode: 'timers', before: '100000000', after: '98000000' },
    { mode: 'control', before: '100000000', after: '99000000' },
  ]), 'no-amplification-observed');
});