// Infrastructure evidence only: never writes canisters or grants admission.
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';

export const GROUP_DOMAINS = Object.freeze(['club_domain', 'events_domain', 'messaging_domain',
  'vault_domain', 'competition_domain', 'club_points_domain', 'mini_league_domain',
  'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs']);
const text = p => typeof p === 'string' ? p : p?.toText?.();
const decimal = n => /^(0|[1-9][0-9]*)$/.test(String(n)) ? String(n) : undefined;
const field = (rows, key) => {
  const found = Array.isArray(rows) ? rows.filter(p => p[0] === key) : [];
  return found.length === 1 ? found[0][1] : undefined;
};

/** The fixed base inventory is trusted; extra groups require a separately
 * reviewed PROD inventory, not IDs self-attested by the router's reply. */
export function assessGroupReadiness(report, reviewedGroups = {}) {
  const gaps = [];
  const add = (code, detail) => gaps.push({ code, detail });
  const registryRow = report.rows.find(r => r.method === 'read_group_registry_page');
  const page = registryRow?.registry?.Ok;
  const identity = report.rows.find(r => r.name === 'identity_access');
  const router = report.rows.find(r => r.name === 'shard_router' && r.method === 'read_group_opening_configuration');
  const approval = report.rows.find(r => r.method === 'read_routing_approval')?.approval?.Ok?.[0];
  if (!report.connectionsComplete) add('CONNECTIONS_INCOMPLETE', 'Some base service connections could not be confirmed.');
  if (!page) add('REGISTRY_UNREADABLE', 'A bounded consensus group registry reply is required.');
  if (page?.next_cursor?.length) add('REGISTRY_TRUNCATED', 'Registry exceeds this bounded audit; no whole-inventory readiness claim.');
  const revision = decimal(page?.revision);
  const configurationRevision = decimal(page?.configuration_revision?.[0]);
  if (!configurationRevision) add('CONFIGURATION_REVISION_MISSING', 'Router must expose its configuration revision.');
  const groups = Array.isArray(page?.groups) ? page.groups : [];
  const placements = Array.isArray(page?.placements) ? page.placements : [];
  if (!groups.length) add('NO_GROUPS_REGISTERED', 'Installed base canisters have not been registered as a group.');
  const idsSeen = new Set(), groupIds = new Set();
  const baseExpected = Object.fromEntries(GROUP_DOMAINS.map(n => [n, PROD_CHECK_IDS[n]]));
  baseExpected.secret_workload_identity = PROD_CHECK_IDS.secret_workload_identity;
  let baseCount = 0;
  const inventories = [];
  for (const group of groups) {
    if (groupIds.has(group.id)) add('DUPLICATE_GROUP', `Duplicate group ${group.id}.`);
    groupIds.add(group.id);
    const domains = Array.isArray(group.domains) ? group.domains : [];
    const observed = Object.fromEntries(domains.map(d => [d.domain, text(d.canister)]));
    const isBase = observed.club_domain === PROD_CHECK_IDS.club_domain;
    if (isBase) baseCount++;
    const expected = isBase ? baseExpected : reviewedGroups[group.id]?.domains;
    const photo = text(group.photo_store?.[0]);
    const expectedPhoto = isBase ? PROD_CHECK_IDS.media_blob_store : reviewedGroups[group.id]?.photoStore;
    if (!expected || !expectedPhoto) add('UNREVIEWED_GROUP_INVENTORY', `${group.id}: independent PROD inventory needs review.`);
    if (group.target_alias !== 'mainnet') add('WRONG_TARGET', `${group.id}: unexpected target alias.`);
    if (new Set(domains.map(d => d.domain)).size !== domains.length ||
        domains.length !== GROUP_DOMAINS.length + 1 || GROUP_DOMAINS.some(n => !observed[n]) || !observed.secret_workload_identity)
      add('PARTIAL_GROUP', `${group.id}: complete domain and workload inventory required.`);
    if (expected && (Object.keys(observed).length !== Object.keys(expected).length ||
        Object.keys(expected).some(n => observed[n] !== expected[n])))
      add('GROUP_ID_MISMATCH', `${group.id}: domain IDs differ from reviewed PROD inventory.`);
    if (!photo || (expectedPhoto && photo !== expectedPhoto)) add('PHOTO_STORE_MISMATCH', `${group.id}: independent photo store must match reviewed inventory.`);
    // Workload identity is deliberately shared; all data services/stores must be independent.
    for (const id of [...GROUP_DOMAINS.map(n => observed[n]), photo].filter(Boolean)) {
      if (idsSeen.has(id)) add('SHARED_DATA_CANISTER', `${group.id}: a data canister is reused across groups.`);
      idsSeen.add(id);
    }
    const matching = placements.filter(p => p.group_id === group.id);
    const placement = matching[0];
    if (matching.length !== 1 || !placement || placement.host !== 'https://icp-api.io' ||
        placement.network_kind !== 'public_mainnet' || placement.deployment_id !== 'prod' ||
        !decimal(placement.deployment_revision) || String(placement.deployment_revision) === '0' ||
        !text(placement.primary_subnet) || placement.additional_subnets_enabled ||
        placement.approved_subnets?.length !== 1 || text(placement.approved_subnets?.[0]) !== text(placement.primary_subnet) ||
        placement.domains?.length !== domains.length ||
        domains.some(d => placement.domains.filter(p => p.domain === d.domain && text(p.canister) === text(d.canister) &&
          text(p.subnet) === text(placement.primary_subnet)).length !== 1))
      add('PLACEMENT_INCOMPLETE', `${group.id}: exact PROD HTTPS/network/subnet placement required.`);
    inventories.push({ id: group.id, base: isBase, accepting: group.accepting === true,
      domains: observed, photoStore: photo });
  }
  if (baseCount !== 1) add('BASE_GROUP_MISSING', 'Exactly one group must contain the existing PROD base inventory.');
  if (!groups.some(g => g.id === 'g2' && g.domains?.some(d => d.domain === 'club_domain' && text(d.canister) !== PROD_CHECK_IDS.club_domain)))
    add('PROD_G2_MISSING', 'DEV-equivalent architecture requires an independent PROD g2.');
  if (field(identity?.configuration, 'registry') !== PROD_CHECK_IDS.shard_router ||
      field(identity?.configuration, 'deployment_id') !== 'prod' ||
      field(identity?.configuration, 'target_alias') !== 'mainnet' ||
      field(identity?.configuration, 'host') !== 'https://icp-api.io' ||
      field(identity?.configuration, 'network_kind') !== 'public_mainnet')
    add('IDENTITY_REGISTRY_NOT_BOUND', 'Identity access is not pinned to this independent PROD registry/deployment.');
  if (field(router?.configuration, 'deletion_authority') !== PROD_CHECK_IDS.identity_access)
    add('ROUTER_IDENTITY_NOT_BOUND', 'Router deletion authority must be the PROD identity service.');
  if (field(identity?.configuration, 'bound_deletion_released') !== 'true')
    add('DELETION_RELEASE_UNVERIFIED', 'Supported bound-deletion release needs exact review and live evidence; no rehearsal flags.');
  if (!approval) add('ROUTING_APPROVAL_MISSING', 'No PROD routing approval recorded.');
  else if (approval.target_alias !== 'mainnet' || decimal(approval.configuration_revision) !== configurationRevision ||
      !/^[a-f0-9]{64}$/.test(approval.approved_configuration_sha256) || !/^[a-f0-9]{64}$/.test(approval.evidence_sha256) ||
      !decimal(approval.removal_checked_at_ms) || String(approval.removal_checked_at_ms) === '0' ||
      JSON.stringify([...approval.removal_wiring_group_ids].sort()) !== JSON.stringify([...groupIds].sort()))
    add('ROUTING_APPROVAL_STALE', 'Approval must match configuration revision and the complete removal-wiring inventory.');
  // This audit does not check lifecycle, module/subnet attestations, all settings,
  // all group reciprocal links or independent approval provenance. Never grant opening.
  return { infrastructureComplete: gaps.length === 0, openingAuthorized: false,
    revision, configurationRevision, groups: inventories, gaps,
    limits: ['Not a live opening grant.', 'Full module, settings, removal-wiring and approval provenance acceptance remains separate.'] };
}

export function setupProposal(readiness) {
  return { scope: 'PROD canister groups only', executable: false, openingAuthorized: false,
    reason: 'Review-only proposal; signed evidence and exact-bound mutation/funding approvals required.',
    gaps: readiness.gaps, sequence: [
      { step: 'Review complete signed PROD inventory and live DEV group state', mutation: false },
      { step: 'Review supported identity/deletion lifecycle release and PROD-only settings', mutation: false },
      { step: 'Configure and register existing PROD base group closed', mutation: true, approvalRequired: true },
      { step: 'Quote shortfall for independent PROD g2; reuse only a verified existing inventory', mutation: false },
      { step: 'Create/configure independent PROD g2 and register closed', mutation: true, approvalRequired: true },
      { step: 'Verify full modules/settings/removal wiring and record configuration-bound PROD approval', mutation: true, approvalRequired: true },
      { step: 'Open exact approved groups only after fresh checks and explicit confirmation', mutation: true, approvalRequired: true },
    ], forbidden: ['DEV IDs or data copying', 'Reinstall', 'Rehearsal flags', 'Database changes', 'Publishing or DNS changes'] };
}