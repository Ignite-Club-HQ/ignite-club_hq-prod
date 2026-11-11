import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRequest, CONFIRMATIONS } from './prod-native-push-rollout.mjs';
test('inspect needs no phrase', () => assertRequest('inspect', ''));
test('enable needs exact phrase', () => {
  assert.throws(() => assertRequest('enable', 'yes'));
  assertRequest('enable', CONFIRMATIONS.enable);
});
test('disable phrase cannot enable', () => assert.throws(() => assertRequest('enable', CONFIRMATIONS.disable)));
test('unknown action refused', () => assert.throws(() => assertRequest('purge', '')));
