// Pure, complete PROD inventory planning. No install, settings or opening capability.
import { UPGRADE_ORDER } from './icp-environments.mjs';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';
import { reviewedG2Inventory } from './prod-g2-register-policy.mjs';

const text = value => typeof value === 'string' ? value : value?.toText?.();
const groupServices = [...GROUP_DOMAINS, 'media_blob_store'];
const sharedServices = UPGRADE_ORDER.filter(name => !groupServices.includes(name));
const sameNames = (actual, expected) => actual.length === expected.length && new Set(actual).size === actual.length && expected.every(name => actual.includes(name));

export function planProdReleaseTargets({ ids, g2Receipt, page, hashes }) {
  if (!sameNames(Object.keys(ids), UPGRADE_ORDER) || UPGRADE_ORDER.some(name => ids[name] !== PROD_CHECK_IDS[name])) throw Error('Exact 18-service PROD base inventory required');
  const second = reviewedG2Inventory(g2Receipt);
  if (!sameNames(Object.keys(second.domains), [...GROUP_DOMAINS, 'secret_workload_identity']) || second.domains.secret_workload_identity !== ids.secret_workload_identity) throw Error('Exact independent g2 domains and original shared workload required');
  const groups = page?.groups, placements = page?.placements;
  if (!Array.isArray(groups) || !Array.isArray(placements) || !sameNames(groups.map(g => g.id), ['base', 'g2']) || !sameNames(placements.map(p => p.group_id), ['base', 'g2']) || page.next_cursor?.length || page.configuration_revision?.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(String(page.configuration_revision[0]))) throw Error('Complete revision-bound two-group PROD registry required');
  const inventories = { base: ids, g2: { ...second.domains, media_blob_store: second.photoStore } };
  const subnets = {};
  for (const group of groups) {
    const expected = inventories[group.id], placement = placements.find(p => p.group_id === group.id);
    if (group.accepting !== false || group.target_alias !== 'mainnet' || !placement || placement.deployment_id !== 'prod' || placement.host !== 'https://icp-api.io' || placement.network_kind !== 'public_mainnet' || placement.additional_subnets_enabled !== false || placement.approved_subnets?.length !== 1 || text(placement.primary_subnet) !== text(placement.approved_subnets[0])) throw Error('Exact closed single-subnet PROD placement required');
    const names = [...GROUP_DOMAINS, 'secret_workload_identity'];
    if (!sameNames(group.domains.map(d => d.domain), names) || !sameNames(placement.domains.map(d => d.domain), names) || group.photo_store?.length !== 1 || text(group.photo_store[0]) !== expected.media_blob_store) throw Error('Complete group domains and original photo store required');
    for (const name of names) {
      const domain = group.domains.find(d => d.domain === name), placed = placement.domains.find(d => d.domain === name);
      if (text(domain?.canister) !== expected[name] || text(placed?.canister) !== expected[name] || text(placed?.subnet) !== text(placement.primary_subnet)) throw Error('Reviewed group and live placement differ');
    }
    subnets[group.id] = text(placement.primary_subnet);
  }
  if (!sameNames(Object.keys(hashes), UPGRADE_ORDER) || UPGRADE_ORDER.some(name => !/^[a-f0-9]{64}$/.test(hashes[name] ?? ''))) throw Error('Exact 18-service artifact fingerprint inventory required');
  const targets = UPGRADE_ORDER.flatMap(name => sharedServices.includes(name)
    ? [{ groupId: 'shared', name, canisterId: ids[name], subnetId: subnets.base, newHash: hashes[name] }]
    : ['base', 'g2'].map(groupId => ({ groupId, name, canisterId: inventories[groupId][name], subnetId: subnets[groupId], newHash: hashes[name] })));
  if (targets.length !== 31 || new Set(targets.map(t => t.canisterId)).size !== 31) throw Error('31 unique PROD targets required; cross-group collisions refused');
  return { targets, configurationRevision: String(page.configuration_revision[0]), openingAuthorized: false, publicationAuthorized: false };
}

// Exact historical identity and newer immutable pins are distinct releases.
// Never treat exporting unused env values as proof that the program enforces pins.
export function assertIdentitySourceSupportsPins(source, pins) {
  if (!pins?.IGNITE_PRODUCTION_ACCOUNT_WITNESS) return;
  if (!/mod production_account_authorization\s*;/.test(source) || !/mod production_account_protection\s*;/.test(source)) throw Error('Historical identity lacks retained safeguard binding; exact rollback needs an explicit owner decision');
}

/** Retained identity is observed, not a target to install or rebuild. */
export function retainProdIdentity(plan, observedIdentityHash) {
  if (!/^[a-f0-9]{64}$/.test(observedIdentityHash ?? '')) throw Error('Observed PROD identity fingerprint required');
  const identity = plan.targets.filter(target => target.name === 'identity_access');
  if (identity.length !== 1 || plan.targets.length !== 31) throw Error('Complete two-group plan required before retaining identity');
  return { ...plan, targets: plan.targets.filter(target => target.name !== 'identity_access'), retained: [{ ...identity[0], newHash: observedIdentityHash }], exactDevParity: false };
}

/** Signed production reads require the receiver's real configuration endpoint. */
export function assertRetainedIdentityReceiverCompatibility(identitySource, receiverInterfaces) {
  if (!identitySource.includes('"read_account_protection_configuration"')) return;
  const missing = Object.entries(receiverInterfaces).filter(([, source]) => !/\bread_account_protection_configuration\b/.test(source)).map(([name]) => name);
  if (missing.length) throw Error(`Retained PROD identity requires receiver protection interface absent from historical services: ${missing.join(', ')}`);
}