import test from 'node:test';
import assert from 'node:assert/strict';
import { timerCounts, classifyRetry, IDLE_MINUTES, LOW_FUEL_ROUNDS } from './club-fuel-policy.mjs';

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