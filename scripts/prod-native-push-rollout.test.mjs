import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRequest, CONFIRMATIONS, LIVE_QUEUE, LIVE_GROUP_QUEUES,
  assertSafeProdPushTargets, readProdPushSnapshot,
} from './prod-native-push-rollout.mjs';

test('inspection remains available without a phrase', () => assertRequest('inspect', ''));
test('manual emergency disable requires the exact phrase', () => {
  assert.throws(() => assertRequest('disable', 'yes'));
  assertRequest('disable', CONFIRMATIONS.disable);
});
test('all-member enable is held even with the old exact confirmation phrase', () => {
  assert.throws(() => assertRequest('enable', 'yes'), /held/);
  assert.throws(() => assertRequest('enable', CONFIRMATIONS.enable), /held/);
});
test('disable confirmation never enables PROD push', () =>
  assert.throws(() => assertRequest('enable', CONFIRMATIONS.disable)));
test('unknown action refused', () => assert.throws(() => assertRequest('purge', '')));

test('governor rollout is pinned only to reviewed PROD Base and G2, not DEV', () => {
  const snapshot = readProdPushSnapshot();
  assert.equal(assertSafeProdPushTargets(snapshot), true);
  const registeredBase = snapshot.groups.find(g => g.id === 'base').domains.find(d => d.domain === 'notification_queue').canisterId;
  const registeredG2 = snapshot.groups.find(g => g.id === 'g2').domains.find(d => d.domain === 'notification_queue').canisterId;
  assert.equal(LIVE_QUEUE, registeredBase);
  assert.deepEqual(LIVE_GROUP_QUEUES, [registeredG2]);
  assert.equal(registeredG2, 'vnmx4-kyaaa-aaaai-aye2a-cai');
  assert.notEqual(registeredG2, 'zu4gk-vqaaa-aaaal-qxp5a-cai');
});

test('rejects PROD mixed with DEV G2 before any actor or key activity', () => {
  const tampered = structuredClone(readProdPushSnapshot());
  tampered.groups.find(g => g.id === 'g2').domains.find(d => d.domain === 'notification_queue').canisterId = 'zu4gk-vqaaa-aaaal-qxp5a-cai';
  assert.throws(() => assertSafeProdPushTargets(tampered), /mismatch/);
});
test('rejects unreviewed PROD router or additional group', () => {
  const snapshot = readProdPushSnapshot();
  assert.throws(() => assertSafeProdPushTargets({ ...snapshot, routerCanisterId: 'changed' }), /topology/);
  assert.throws(() => assertSafeProdPushTargets({ ...snapshot, groups: [...snapshot.groups, {id: 'g3', domains: []}] }), /topology/);
  assert.throws(() => assertSafeProdPushTargets({ ...snapshot, approved: false }), /topology/);
});
