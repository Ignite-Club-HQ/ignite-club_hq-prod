// Pure guards for the fencing toolkit: no server, no wasms, no fixtures.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Principal } from '@icp-sdk/core/principal';
import { assertIndependentFence, assertExclusiveController, fenceSnapshot, INDEPENDENT_FENCE } from './external-controller-fencing.mjs';

const p = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const status = controllers => ({
  status: { running: null },
  settings: { controllers, compute_allocation: 0n, memory_allocation: 0n, freezing_threshold: 0n },
  module_hash: [new Uint8Array(32).fill(7)], memory_size: 4096n,
});

test('the independent fence is never an operator, authority, witness or participant', () => {
  const participants = [p(1), p(2), p(3), p(4)];
  assert.equal(assertIndependentFence(INDEPENDENT_FENCE, participants), true);
  assert.throws(() => assertIndependentFence(p(2), participants), /must not be an operator/);
  assert.throws(() => assertIndependentFence(Principal.anonymous(), participants), /grant control to everyone/);
  assert.throws(() => assertIndependentFence('not-a-principal', participants), /real principal/);
});

test('two controllers is never exclusive, whatever the order', () => {
  const fence = INDEPENDENT_FENCE, operator = p(1);
  assert.throws(() => assertExclusiveController(status([fence, operator]), fence), /Exactly one independent controller/);
  assert.throws(() => assertExclusiveController(status([operator, fence]), fence), /Exactly one independent controller/);
  assert.throws(() => assertExclusiveController(status([operator]), fence), /Exactly one independent controller/);
  assert.deepEqual(assertExclusiveController(status([fence]), fence).controllers, [fence.toText()]);
});

test('a snapshot records the exact module and live memory that a refusal must preserve', () => {
  const snapshot = fenceSnapshot(status([INDEPENDENT_FENCE]));
  assert.equal(snapshot.moduleHash, '07'.repeat(32));
  assert.equal(snapshot.memorySize, '4096');
  assert.equal(snapshot.running, true);
  const uninstalled = { ...status([INDEPENDENT_FENCE]), module_hash: [] };
  assert.equal(fenceSnapshot(uninstalled).moduleHash, null);
});
