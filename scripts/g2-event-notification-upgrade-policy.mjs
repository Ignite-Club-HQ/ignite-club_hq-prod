import { digest } from './subscription-upgrade-policy.mjs';
import { reconcileUpgradeStep, GROUP2_GOVERNOR } from './group2-upgrade-rules.mjs';

// This is a Group 2 MAINNET pair, not a private DEV network.
export const PAIR = Object.freeze([
  Object.freeze({ groupId: 'g2', name: 'notification_queue', canisterId: 'zu4gk-vqaaa-aaaal-qxp5a-cai' }),
  Object.freeze({ groupId: 'g2', name: 'club_domain', canisterId: 'yfwyv-nyaaa-aaaal-qxpyq-cai' }),
]);
export const RELEASE_CONFIRMATION = 'UPGRADE G2 EVENT NOTIFICATION PAIR';
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;

export function validateRequest({action, confirmation = '', release = '', actualCommit = '', expectedQueueHash = '', expectedClubHash = ''}) {
  if (!['check', 'upgrade'].includes(action)) throw Error('Choose check or upgrade only');
  if (action === 'check') {
    if (confirmation || expectedQueueHash || expectedClubHash) throw Error('Read-only check must not carry upgrade confirmation or prior hashes');
    return;
  }
  if (confirmation !== RELEASE_CONFIRMATION) throw Error('Explicit exact two-canister approval is required');
  if (!SHA.test(release) || release !== actualCommit || !SHA.test(actualCommit)) throw Error('Pinned source SHA does not match workflow source');
  if (!HASH.test(expectedQueueHash) || !HASH.test(expectedClubHash)) throw Error('Copy both live module hashes from the completed check');
}

export function validatePair(targets, provision) {
  if (!Array.isArray(targets) || targets.length !== 2 ||
      !provision || provision.groupId !== 'g2' || provision.deploymentId !== 'mainnet' ||
      provision.subnetId !== 'e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe')
    throw Error('Only the known Group 2 mainnet pair is accepted');
  const ids = new Set();
  for (let i = 0; i < PAIR.length; i++) {
    const expected = PAIR[i], t = targets[i];
    if (!t || t.name !== expected.name || t.groupId !== expected.groupId || t.canisterId !== expected.canisterId ||
        ids.has(t.canisterId) || t.subnetId !== provision.subnetId || !HASH.test(t.newHash))
      throw Error('Unapproved canister, order, subnet, or Wasm hash');
    if (provision.canisters[t.name] !== t.canisterId || provision.observedSubnets[t.name] !== t.subnetId)
      throw Error('Provision mapping mismatch');
    ids.add(t.canisterId);
  }
}

export function validateRegistration(targets, groups, placements, provision) {
  validatePair(targets, provision);
  const group = groups.find(g => g.id === 'g2');
  const placement = placements.find(p => p.group_id === 'g2');
  if (!group || !placement || group.target_alias !== 'mainnet' ||
      placement.deployment_id !== 'mainnet' || placement.host !== 'https://icp-api.io' ||
      placement.network_kind !== 'public_mainnet' || placement.primary_subnet.toText() !== provision.subnetId ||
      group.photo_store[0]?.toText() !== provision.dedicatedBlobStore.canisterId)
    throw Error('Group 2 router/placement configuration mismatch');
  for (const t of targets) {
    if (group.domains.filter(d => d.domain === t.name && d.canister.toText() === t.canisterId).length !== 1 ||
        placement.domains.filter(d => d.domain === t.name && d.canister.toText() === t.canisterId &&
          d.subnet.toText() === t.subnetId).length !== 1)
      throw Error('Unexpected live Group 2 canister registration');
  }
}

// Used on the governor-authenticated, bounded read_group_opening_configuration;
// do not fetch notification bodies, users, device tokens or private queue state.
export function requireWiring(name, rows, provision) {
  if (!Array.isArray(rows) || rows.length > 128 || rows.some(r => !Array.isArray(r) || r.length !== 2))
    throw Error('Invalid authority wiring readback');
  const expected = name === 'notification_queue'
    ? { club_domain: provision.canisters.club_domain }
    : { club_domain: provision.canisters.club_domain, notification_queue: provision.canisters.notification_queue,
        events_domain: provision.canisters.events_domain };
  for (const [k, id] of Object.entries(expected)) {
    if (rows.filter(r => r[0] === k && r[1] === id).length !== 1 ||
        rows.filter(r => r[0] === k).length !== 1)
      throw Error('Untrusted or missing '+ name + '/' + k + ' authority');
  }
  return digest([...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

export function validateJournal(journal, binding) {
  validatePair(binding.targets, binding.provision);
  if (!journal || digest(journal.binding) !== digest(binding) ||
      !Array.isArray(journal.steps) || journal.steps.length !== 2 ||
      typeof journal.complete !== 'boolean' || new Set(journal.steps.map(s=>s.canisterId)).size !== 2 ||
      !/^\d+$/.test(journal.routerRevision) || !HASH.test(journal.configurationHash))
    throw Error('Foreign, corrupt or incomplete two-canister release journal');
  for (const t of binding.targets) {
    const step = journal.steps.find(s=>s.canisterId===t.canisterId);
    if (!step || step.name !== t.name || step.groupId !== 'g2' || step.subnetId !== t.subnetId ||
        step.newHash !== t.newHash || step.oldHash !== binding.oldHashes[t.name] ||
        !HASH.test(step.oldHash) || !HASH.test(step.settingsHash) || !HASH.test(step.wiringHash) ||
        !['ready','pending','complete'].includes(step.phase))
      throw Error('Unrecognized journal target/phase');
  }
  if (journal.complete && journal.steps.some(s => s.phase !== 'complete')) throw Error('Incomplete final journal');
}

export async function executeTwoCanisterUpgrade(journal, io) {
  if (journal.steps.length !== 2 ||
      journal.steps[0].name !== 'notification_queue' || journal.steps[1].name !== 'club_domain')
    throw Error('Unexpected release order');
  if (journal.complete) {
    await io.gate();
    for (const step of journal.steps) {
      const current = await io.observe(step);
      if (current.moduleHash !== step.newHash || current.settingsHash !== step.settingsHash ||
          current.wiringHash !== step.wiringHash) throw Error('Completed release drift');
    }
    return;
  }
  for (const step of journal.steps) {
    await io.gate();
    const before = await io.observe(step);
    if (before.settingsHash !== step.settingsHash || before.wiringHash !== step.wiringHash)
      throw Error('Canister authority/settings changed before upgrade');
    Object.assign(step,reconcileUpgradeStep(step,before.moduleHash));
    if (step.phase !== 'complete' && step.oldHash !== step.newHash) {
      step.phase='pending';
      await io.persist(journal); // Durable GitHub write AND exact committed-blob readback, before installation.
      await io.install(step);    // No automatic retry of unknown pending installs.
    }
    const after=await io.observe(step);
    if (after.moduleHash !== step.newHash || after.settingsHash !== step.settingsHash ||
        after.wiringHash !== step.wiringHash)
      throw Error('Module/settings/wiring verification failed; journal remains pending');
    if (BigInt(before.stableBytes ?? '0') > 0n && BigInt(after.stableBytes ?? '0') === 0n)
      throw Error('Unexpected empty stable memory: manual state recovery required');
    if (step.name === 'club_domain' && before.clubs !== undefined && before.clubs > 0n && after.clubs === 0n)
      throw Error('Club data vanished after upgrade; halt for investigation');
    step.phase='complete';
    await io.persist(journal);
  }
  await io.gate();
  for(const step of journal.steps) {
    const s=await io.observe(step);
    if(s.moduleHash !== step.newHash || s.settingsHash !== step.settingsHash || s.wiringHash !== step.wiringHash)
      throw Error('Final state or wiring drift');
  }
  await io.gate();
  journal.complete=true; await io.persist(journal);
}
