// Closed-only orchestration core. Adapters own certified transport and builds;
// no default live transport or inferred evidence is supplied here.
import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = value => /^[a-f0-9]{64}$/.test(value ?? '') && !/^0+$/.test(value);
export function reviewSafeguardSetup(plan) {
  if (plan?.version !== 1 || plan.repository !== 'Ignite-Club-HQ/ignite-club_hq-prod' || plan.branch !== 'prod' ||
      !/^[a-f0-9]{40}$/.test(plan.sourceCommit ?? '') || !plan.identity || !plan.witnessController ||
      plan.witnessController === plan.governor || !plan.governor || !plan.subnet ||
      !digest(plan.accountPublicKey) || !digest(plan.recoveryPublicKey) || plan.accountPublicKey === plan.recoveryPublicKey ||
      !digest(plan.witnessModuleHash) || !digest(plan.identityModuleHash) ||
      !/^[0-9]+$/.test(plan.createAmount ?? '') || BigInt(plan.createAmount) <= 0n ||
      !Array.isArray(plan.receivers) || plan.receivers.length !== 28 || new Set(plan.receivers).size !== 28 ||
      plan.receivers.includes(plan.identity) || !Array.isArray(plan.groups) || plan.groups.length !== 2 ||
      plan.groups.map(g => g.id).sort().join(',') !== 'base,g2' || plan.groups.some(g => g.accepting !== false))
    throw Error('Exact reviewed closed safeguard plan required');
  return hash(plan);
}
export async function provisionSafeguard({ plan, reviewedHash, confirmation, journal, calls, nowNs }) {
  const planHash = reviewSafeguardSetup(plan);
  if (reviewedHash !== planHash || confirmation !== 'SET UP PROD SAFEGUARD CLOSED') throw Error('Reviewed safeguard confirmation required');
  let receipt = await journal.load({ readOnly: true });
  if (receipt && (receipt.planHash !== planHash || receipt.pending)) throw Error('Pending or different safeguard intent; reconcile read-only before continuing');
  await calls.assertClosedBinding(plan);
  if (!receipt) {
    await journal.load();
    receipt = { version: 1, phase: 'planned', planHash, plan, pending: null, witness: null, openingAuthorized: false };
    await journal.save(receipt);
  }
  async function stage(kind, perform, verify) {
    await calls.assertClosedBinding(plan);
    receipt = { ...receipt, pending: { kind, atNs: nowNs().toString() } };
    await journal.save(receipt);
    const outcome = await perform();
    const fields = await verify(outcome);
    receipt = { ...receipt, ...fields, phase: kind, pending: null };
    await journal.save(receipt);
  }
  if (!receipt.witness) await stage('witness-created',
    () => calls.createWitness({ amount: BigInt(plan.createAmount), createdAtNs: BigInt(receipt.pending.atNs), subnet: plan.subnet, controllers: [plan.witnessController] }),
    async witness => {
      if (!witness || witness === plan.identity || plan.receivers.includes(witness)) throw Error('Distinct witness required');
      const state = await calls.witnessStatus(witness);
      if (state.moduleHash !== null || state.subnet !== plan.subnet || JSON.stringify(state.controllers) !== JSON.stringify([plan.witnessController]))
        throw Error('Witness creation readback mismatch');
      return { witness };
    });
  if (receipt.phase === 'witness-created') await stage('witness-installed',
    () => calls.installWitness({ witness: receipt.witness, moduleHash: plan.witnessModuleHash, recoveryPublicKey: plan.recoveryPublicKey,
      init: { governor: plan.witnessController, identity: plan.identity } }),
    async () => {
      const state = await calls.witnessStatus(receipt.witness);
      if (state.moduleHash !== plan.witnessModuleHash || state.subnet !== plan.subnet ||
          JSON.stringify(state.controllers) !== JSON.stringify([plan.witnessController])) throw Error('Witness installation readback mismatch');
      await calls.verifyWitnessIdentity(receipt.witness, plan.identity);
      return {};
    });
  if (receipt.phase === 'witness-installed') await stage('identity-pinned',
    () => calls.upgradeIdentityOnly({ identity: plan.identity, moduleHash: plan.identityModuleHash, witness: receipt.witness,
      accountPublicKey: plan.accountPublicKey, recoveryPublicKey: plan.recoveryPublicKey }),
    async () => { await calls.verifyIdentityPins({ ...plan, witness: receipt.witness }); return {}; });
  await calls.assertClosedBinding(plan);
  // Provisioning is not signed protection acceptance and never turns on flags.
  return { ...receipt, activationAuthorized: false, controlRecordVerified: false };
}

export function verifyControlRecordReadback({ expectedReceivers, configurations, readerIds, approval, groups, witnessVerified, effectiveVerified }) {
  if (expectedReceivers.length !== 28 || new Set(expectedReceivers).size !== 28 || configurations.length !== 28 ||
      new Set(configurations.map(c => c.receiver)).size !== 28 || readerIds.length !== 24 || new Set(readerIds).size !== 24 ||
      readerIds.some(id => !expectedReceivers.includes(id)) || groups.length !== 2 || groups.map(g => g.id).sort().join(',') !== 'base,g2' ||
      groups.some(g => g.accepting !== false) || !approval || !witnessVerified || !effectiveVerified ||
      configurations.some(c => !expectedReceivers.includes(c.receiver) || c.authority !== approval.identity || c.protocol !== 1 ||
        c.rehearsal !== false || c.removal_enabled !== true || (readerIds.includes(c.receiver) && c.admission_required !== true)))
    throw Error('Complete effective control-record verification required');
  return configurations.map(c => ({ receiver: c.receiver, controlRecordVerified: true }));
}