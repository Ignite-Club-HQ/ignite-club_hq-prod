import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callPreparationBinding, rehearseDestinationCall, reconcileDestinationCall } from './engine-call-preparation.mjs';
import { writePreparationBackup } from './engine-operational-preparation.mjs';
import { rehearseLocalGroupRestore } from './engine-group-restore-drill.mjs';

const destination = { deploymentId: 'isolated-test', host: 'https://isolated.invalid', networkKind: 'cloud_engine',
  registryRevision: '9007199254740993', services: ['identity', 'club', 'events', 'messages', 'queue', 'vault', 'blob'].map(service => ({
    service, canisterId: `${service}-fixture`, subnetId: 'destination-fixture', moduleHash: 'a'.repeat(64) })) };
const call = { kind: 'write', operation: 'op-1', caller: 'fixture-user', sourceSubnet: 'source-fixture',
  service: 'events', method: 'save', argumentHash: 'b'.repeat(64), timeoutSeconds: 1, destination };
function journal() {
  let state;
  return { assertExclusiveWriter: async () => {}, save: async s => { state = structuredClone(s); }, read: async () => structuredClone(state) };
}
for (const networkKind of ['public_mainnet', 'cloud_engine']) test(`bounded cycle-free destination ${networkKind}`, async () => {
  const c = { ...call, destination: { ...destination, networkKind } }, j = journal();
  const report = await rehearseDestinationCall(c, { call: async observed => {
    assert.equal(Object.hasOwn(observed, 'cycles'), false); assert.equal(observed.timeoutSeconds, 1);
    assert.equal((await j.read()).phase, 'pending');
    return { binding: callPreparationBinding(c), operation: c.operation, outcome: 'committed' };
  } }, j);
  assert.equal(report.outcome, 'committed'); assert.equal(report.activationAuthorized, false);
});
test('cycles, invalid wait and unregistered service refuse before dispatch', async () => {
  for (const c of [{ ...call, cycles: 0n }, { ...call, timeoutSeconds: 301 }, { ...call, service: 'foreign' }]) {
    let calls = 0;
    await assert.rejects(rehearseDestinationCall(c, { call: async () => { calls++; } }, journal()));
    assert.equal(calls, 0);
  }
});
test('lost write reply stays pending across restart and settles only through exact readback', async () => {
  const j = journal(); let writes = 0;
  const adapter = { call: async () => { writes++; throw Error('SYS_UNKNOWN'); },
    readOutcome: async (binding, operation) => ({ binding, operation, outcome: 'committed' }) };
  assert.equal((await rehearseDestinationCall(call, adapter, j)).outcome, 'unknown');
  await assert.rejects(rehearseDestinationCall(call, adapter, j), /no replay/);
  assert.equal((await reconcileDestinationCall(call, adapter, j)).outcome, 'committed'); assert.equal(writes, 1);
});
test('deadline returns unknown; a late commit cannot clear the durable hold', async () => {
  const j = journal(); let finish;
  const work = rehearseDestinationCall(call, { call: () => new Promise(resolve => { finish = resolve; }) }, j);
  assert.equal((await work).outcome, 'unknown');
  finish({ binding: callPreparationBinding(call), operation: call.operation, outcome: 'committed' });
  await Promise.resolve(); assert.equal((await j.read()).phase, 'pending');
});
test('missing or foreign outcome never authorizes resend', async () => {
  const j = journal(); await rehearseDestinationCall(call, { call: async () => undefined }, j);
  for (const reply of [undefined, { binding: 'foreign', operation: call.operation, outcome: 'committed' }]) {
    assert.equal((await reconcileDestinationCall(call, { readOutcome: async () => reply }, j)).outcome, 'unknown');
    assert.equal((await j.read()).phase, 'pending');
  }
  for (const changed of [{ ...call, caller: 'other' }, { ...call, destination: { ...destination, registryRevision: '9007199254740994' } }]) {
    await assert.rejects(reconcileDestinationCall(changed, {}, j), /Exact pending/);
  }
});
test('failed journal write and lost ownership prevent dispatch', async () => {
  for (const member of ['save', 'assertExclusiveWriter']) {
    const j = journal(); j[member] = async () => { throw Error('Disk or lock failed'); }; let calls = 0;
    await assert.rejects(rehearseDestinationCall(call, { call: async () => { calls++; } }, j)); assert.equal(calls, 0);
  }
});
test('definite refusal settles without a retry or activation', async () => {
  const j = journal(); const report = await rehearseDestinationCall(call, { call: async () => ({
    binding: callPreparationBinding(call), operation: call.operation, outcome: 'refused' }) }, j);
  assert.equal(report.outcome, 'refused'); assert.equal((await j.read()).phase, 'refused');
});
const expected = destination.services.map(s => ({ service: s.service, content: {
  roles: ['member'], denied: ['removed-user'], pending: ['op-2'], history: [0, null, 2], quota: 0,
  ciphertext: 'local-fixture-only' } }));
async function backup(run) {
  const directory = await mkdtemp(join(tmpdir(), 'group-drill-')), path = join(directory, 'backup.json'), key = randomBytes(32);
  try {
    await writePreparationBackup(path, destination, 1000, async s => Buffer.from(JSON.stringify(expected.find(e => e.service === s.service).content)), key);
    await run(path, key);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
test('rebuilds full supplied group with permissions, pending work, zero and null preserved', () => backup(async (path, key) => {
  const report = await rehearseLocalGroupRestore(path, destination, key, expected, async (_s, bytes) => JSON.parse(bytes));
  assert.equal(report.services, 7); assert.equal(report.localGroupRebuilt, true); assert.ok(report.elapsedMs >= 0);
  assert.equal(report.liveGroupRestored, false); assert.equal(report.activationAuthorized, false); assert.equal(report.encryptedMediaRecoverable, false);
}));
for (const field of ['roles', 'denied', 'pending', 'history', 'quota']) test(`restore refuses lost ${field}`, () => backup(async (path, key) => {
  await assert.rejects(rehearseLocalGroupRestore(path, destination, key, expected, async (_s, bytes) => {
    const value = JSON.parse(bytes); delete value[field]; return value;
  }), /differs/);
}));
test('partial before-image and wrong encryption key refuse full rebuild', () => backup(async (path, key) => {
  await assert.rejects(rehearseLocalGroupRestore(path, destination, key, expected.slice(1), JSON.parse), /Complete/);
  let decoded = 0;
  await assert.rejects(rehearseLocalGroupRestore(path, destination, randomBytes(32), expected, async () => { decoded++; }));
  assert.equal(decoded, 0);
}));