/** Group 2 mainnet roster-only release: exactly one existing canister.
 * This deliberately cannot install queue, event, messaging, or PROD code. */
import { digest } from './subscription-upgrade-policy.mjs';
import { reconcileUpgradeStep } from './group2-upgrade-rules.mjs';

export const TARGET = Object.freeze({
  name: 'club_domain',
  groupId: 'g2',
  canisterId: 'yfwyv-nyaaa-aaaal-qxpyq-cai',
});
export const CONFIRMATION = 'UPGRADE G2 CLUB ROSTER ONLY';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
export function validateRequest({ action, confirmation = '', release = '', actualCommit = '', oldHash = '' }) {
  if (!['check','upgrade'].includes(action)) throw Error('Only read-only check or club-only upgrade permitted');
  if (action === 'check') {
    if (confirmation || release || oldHash) throw Error('Read-only check has no upgrade approval or previous module hash');
    return;
  }
  if (confirmation !== CONFIRMATION) throw Error('Explicit club-roster-only approval required');
  if (!SHA.test(release) || !SHA.test(actualCommit) || release !== actualCommit)
    throw Error('Reviewed source SHA must match main workflow source exactly');
  if (!HASH.test(oldHash)) throw Error('Exact live preflight club module hash required');
}
export function validateTarget(t, provision) {
  if (!t || t.name !== TARGET.name || t.groupId !== TARGET.groupId || t.canisterId !== TARGET.canisterId ||
      !HASH.test(t.newHash ?? '') || provision?.groupId !== 'g2' || provision.deploymentId !== 'mainnet' ||
      provision.subnetId !== 'e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe' ||
      t.subnetId !== provision.subnetId || provision.canisters.club_domain !== t.canisterId ||
      provision.observedSubnets.club_domain !== t.subnetId)
    throw Error('Only pinned existing Group 2 club_domain on original subnet allowed');
}
export function validateRegistration(t, groups, placements, provision) {
  validateTarget(t, provision);
  const group = groups.find(g => g.id === 'g2');
  const placement = placements.find(p => p.group_id === 'g2');
  if (!group || !placement || group.target_alias !== 'mainnet' ||
      placement.deployment_id !== 'mainnet' || placement.host !== 'https://icp-api.io' ||
      placement.network_kind !== 'public_mainnet' ||
      placement.primary_subnet.toText() !== provision.subnetId ||
      group.photo_store[0]?.toText() !== provision.dedicatedBlobStore.canisterId ||
      group.domains.filter(d => d.domain === TARGET.name && d.canister.toText() === TARGET.canisterId).length !== 1 ||
      placement.domains.filter(d => d.domain === TARGET.name && d.canister.toText() === TARGET.canisterId &&
        d.subnet.toText() === t.subnetId).length !== 1)
    throw Error('Group 2 ownership/placement changed');
}
export function validateJournal(journal, binding) {
  validateTarget(binding.target, binding.provision);
  if (!journal || digest(journal.binding) !== digest(binding) || journal.group !== 'g2' ||
      typeof journal.complete !== 'boolean' || journal.routerRevision !== binding.registryRevision ||
      journal.configurationHash !== binding.configurationHash || !HASH.test(journal.configurationHash ?? '') ||
      !journal.step || journal.step.name !== TARGET.name || journal.step.canisterId !== TARGET.canisterId ||
      journal.step.subnetId !== binding.target.subnetId ||
      journal.step.newHash !== binding.target.newHash || journal.step.oldHash !== binding.oldHash ||
      !HASH.test(journal.step.oldHash ?? '') || !HASH.test(journal.step.settingsHash ?? '') ||
      !HASH.test(journal.step.wiringHash ?? '') ||
      !['ready','pending','complete'].includes(journal.step.phase) ||
      (journal.complete && journal.step.phase !== 'complete'))
    throw Error('Unrecognised/corrupt one-canister release receipt');
}
export async function executeUpgrade(journal, io) {
  const step = journal.step;
  if (step.name !== TARGET.name || step.canisterId !== TARGET.canisterId)
    throw Error('Unexpected canister target');
  await io.gate();
  let before = await io.observe(step);
  if (before.settingsHash !== step.settingsHash || before.wiringHash !== step.wiringHash)
    throw Error('Existing authority/settings changed');
  if (journal.complete) {
    if (before.moduleHash !== step.newHash) throw Error('Completed module drift');
    return;
  }
  Object.assign(step, reconcileUpgradeStep(step, before.moduleHash));
  if (step.phase !== 'complete' && step.oldHash !== step.newHash) {
    step.phase = 'pending';
    await io.persist(); // Durable, verified GitHub receipt BEFORE install.
    await io.gate();
    before = await io.observe(step);
    if (before.moduleHash !== step.oldHash || before.settingsHash !== step.settingsHash ||
        before.wiringHash !== step.wiringHash) throw Error('Pre-install state changed; stop without install');
    await io.install(step); // Unknown outcome is never replayed automatically.
  }
  const after = await io.observe(step);
  if (after.moduleHash !== step.newHash || after.settingsHash !== step.settingsHash ||
      after.wiringHash !== step.wiringHash) throw Error('Upgrade or authority verification failed; receipt stays pending');
  if (BigInt(before.stableBytes ?? '0') > 0n && BigInt(after.stableBytes ?? '0') === 0n)
    throw Error('Unexpected stable-memory loss: stop and investigate');
  if (BigInt(before.clubs ?? '0') > 0n && BigInt(after.clubs ?? '0') === 0n)
    throw Error('Club records vanished after upgrade: stop and investigate');
  step.phase = 'complete';
  await io.persist();
  await io.gate();
  const final = await io.observe(step);
  if (final.moduleHash !== step.newHash || final.settingsHash !== step.settingsHash ||
      final.wiringHash !== step.wiringHash) throw Error('Final hash or wiring drift');
  journal.complete = true;
  await io.persist();
}
