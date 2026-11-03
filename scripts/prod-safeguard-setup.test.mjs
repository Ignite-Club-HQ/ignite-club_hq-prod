import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionSafeguard, reviewSafeguardSetup, verifyControlRecordReadback } from './prod-safeguard-setup.mjs';
const plan = { version: 1, repository: 'Ignite-Club-HQ/ignite-club_hq-prod', branch: 'prod', sourceCommit: 'a'.repeat(40),
  identity: 'identity-fixture', governor: 'governor-fixture', witnessController: 'recovery-fixture', subnet: 'subnet-fixture',
  accountPublicKey: '01'.repeat(32), recoveryPublicKey: '02'.repeat(32), witnessModuleHash: 'ab'.repeat(32), identityModuleHash: 'cd'.repeat(32),
  createAmount: '1000000000000', receivers: Array.from({ length: 28 }, (_, i) => `receiver-${i}`), groups: [{ id: 'base', accepting: false }, { id: 'g2', accepting: false }] };
function fixture(failInstall = false) {
  let saved = null, moduleHash = null, creates = 0, upgrades = 0;
  const journal = { async load() { return structuredClone(saved); }, async save(v) { saved = structuredClone(v); } };
  const calls = { async assertClosedBinding() {}, async createWitness() { assert.equal(saved.pending.kind, 'witness-created'); creates++; return 'witness-fixture'; },
    async witnessStatus() { return { moduleHash, subnet: plan.subnet, controllers: [plan.witnessController] }; },
    async installWitness() { if (failInstall) throw Error('unknown outcome'); moduleHash = plan.witnessModuleHash; }, async verifyWitnessIdentity() {},
    async upgradeIdentityOnly() { upgrades++; }, async verifyIdentityPins() {} };
  return { journal, calls, saved: () => saved, creates: () => creates, upgrades: () => upgrades };
}
test('setup refuses DEV, duplicate inventory, open groups and shared controller/key', () => {
  for (const change of [{ branch: 'main' }, { receivers: plan.receivers.slice(1) }, { witnessController: plan.governor },
    { accountPublicKey: plan.recoveryPublicKey }, { groups: [{ id: 'base', accepting: true }, plan.groups[1]] }])
    assert.throws(() => reviewSafeguardSetup({ ...plan, ...change }));
});
test('setup journals each exact mutation, never activates, and settled rerun does not recreate', async () => {
  const f = fixture(); const args = { plan, reviewedHash: reviewSafeguardSetup(plan), confirmation: 'SET UP PROD SAFEGUARD CLOSED', ...f, nowNs: () => 123n };
  const result = await provisionSafeguard(args);
  assert.equal(result.phase, 'identity-pinned'); assert.equal(result.activationAuthorized, false); assert.equal(result.openingAuthorized, false);
  await provisionSafeguard(args); assert.equal(f.creates(), 1); assert.equal(f.upgrades(), 1);
});
test('unknown installation retains pending intent and prevents blind retry', async () => {
  const f = fixture(true); const args = { plan, reviewedHash: reviewSafeguardSetup(plan), confirmation: 'SET UP PROD SAFEGUARD CLOSED', ...f, nowNs: () => 123n };
  await assert.rejects(provisionSafeguard(args)); assert.equal(f.saved().pending.kind, 'witness-installed');
  await assert.rejects(provisionSafeguard(args)); assert.equal(f.creates(), 1); assert.equal(f.upgrades(), 0);
});
test('all 28 effective receivers, 24 readers and live witness are mandatory', () => {
  const input = { expectedReceivers: plan.receivers, readerIds: plan.receivers.slice(0, 24), approval: { identity: plan.identity }, groups: plan.groups,
    witnessVerified: true, effectiveVerified: true, configurations: plan.receivers.map(receiver => ({ receiver, authority: plan.identity, protocol: 1, rehearsal: false, removal_enabled: true, admission_required: true })) };
  assert.equal(verifyControlRecordReadback(input).length, 28);
  for (const change of [{ witnessVerified: false }, { effectiveVerified: false }, { configurations: input.configurations.slice(1) }, { readerIds: input.readerIds.slice(1) }])
    assert.throws(() => verifyControlRecordReadback({ ...input, ...change }));
});