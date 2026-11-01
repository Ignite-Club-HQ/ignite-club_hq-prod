// Pure, read-only review policy for the PROD routing gate. It never opens a
// group, never records an approval and never touches DEV: it states exactly
// which lifecycle wiring evidence a governor routing approval would commit to,
// and refuses to name an approval while any item is unverified.
import { createHash } from 'node:crypto';
import { assertCheckContext, PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';

/** The account-admission release switch (historical LOCAL_REHEARSAL name) is
 * the production cross-group lifecycle gate: with it off, services admit
 * everyone, so removals are not enforced and no approval may be recorded. */
export const ADMISSION_FLAG = 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL';
export const ADMISSION_AUTHORITY = 'IGNITE_ACCOUNT_SERVICE_IDENTITY';
/** Group services that check account admission (timer_jobs and the shared
 * workload identity do not). */
export const ADMISSION_DOMAINS = Object.freeze(GROUP_DOMAINS.filter(n => n !== 'timer_jobs'));

/** Reciprocal service authorities, byte-for-byte the map the shipped client
 * enforces, so a PROD approval can never be wider than what clients accept. */
export const RECIPROCAL_LINKS = Object.freeze({
  club_domain: ['notification_queue', 'mini_league_domain', 'competition_domain', 'events_domain', 'messaging_domain', 'pii_access_control'],
  club_points_domain: ['club_domain'],
  competition_domain: ['club_domain', 'events_domain', 'vault_domain', 'pii_access_control'],
  events_domain: ['club_domain', 'notification_queue', 'mini_league_domain', 'competition_domain'],
  media_blob_store: ['club_domain'],
  messaging_domain: ['club_domain', 'notification_queue', 'competition_domain'],
  mini_league_domain: ['club_domain', 'events_domain'],
  notification_queue: ['club_domain', 'messaging_domain'],
  pii_access_control: ['club_domain', 'competition_domain'],
  vault_domain: ['club_domain', 'competition_domain'],
});

const decimal = n => /^(0|[1-9][0-9]*)$/.test(String(n)) ? String(n) : undefined;
const isHex64 = v => /^[a-f0-9]{64}$/.test(String(v ?? ''));

export function sha256Hex(value) { return createHash('sha256').update(value).digest('hex'); }

export function assertRoutingGateContext(ids, env, principal) {
  assertCheckContext(ids, env, principal);
  if (env.GATE_ACTION && env.GATE_ACTION !== 'check') throw new Error('Only read-only check is supported');
}

/** Canonical approved-configuration text: same key order and sorting as the
 * frontend digest, so a PROD approval binds exactly what clients compare.
 * Runtime health and club counts are excluded; placement and identities are not. */
export function groupApprovalConfiguration(groups, placements) {
  const placed = new Map(placements.map(p => [p.group_id, p]));
  if (placed.size !== placements.length || groups.length !== placements.length ||
      new Set(groups.map(g => g.id)).size !== groups.length)
    throw new Error('Incomplete or duplicate approval inventory');
  return JSON.stringify([...groups].sort((a, b) => a.id.localeCompare(b.id)).map(g => {
    const p = placed.get(g.id);
    if (!p) throw new Error('Missing approved group placement');
    return {
      id: g.id, targetAlias: g.target_alias, accepting: g.accepting,
      maxClubs: g.max_clubs, heapBudgetBytes: String(g.heap_budget_bytes), minCycles: String(g.min_cycles),
      photoStore: g.photo_store?.[0] ?? null,
      domains: g.domains.map(d => ({ domain: d.domain, canisterId: d.canister })).sort((a, b) => a.domain.localeCompare(b.domain)),
      placement: {
        deploymentId: p.deployment_id, revision: String(p.deployment_revision), host: p.host, networkKind: p.network_kind,
        primarySubnet: p.primary_subnet, additionalSubnetsEnabled: p.additional_subnets_enabled,
        approvedSubnets: [...p.approved_subnets].sort(),
        domains: p.domains.map(d => ({ domain: d.domain, canisterId: d.canister, subnetId: d.subnet }))
          .sort((a, b) => a.domain.localeCompare(b.domain)),
      },
    };
  }));
}

const rows = list => Array.isArray(list) ? list : [];
const one = (list, key) => {
  const hits = rows(list).filter(r => r[0] === key);
  return hits.length === 1 ? hits[0][1] : undefined;
};
const any = (list, key, value) => rows(list).some(r => r[0] === key && r[1] === value);
const envValue = (environment, name) => one((environment ?? []).map(e => [e.name, e.value]), name);

/** Exactly the services a group must run: every domain except the deliberately
 * shared workload identity, plus the group-owned photo store. */
export function expectedServices(group, placement) {
  const domains = rows(group?.domains).filter(d => d.domain !== 'secret_workload_identity');
  const store = rows(group?.photo_store)[0];
  const list = [...domains.map(d => ({ name: d.domain, id: d.canister })),
    ...(store ? [{ name: 'media_blob_store', id: store }] : [])];
  return list.map(s => ({ ...s, subnet: rows(placement?.domains).find(p => p.domain === s.name && p.canister === s.id)?.subnet }));
}

/**
 * Read-only gate review. `services` carry management and consensus evidence
 * already reduced to plain text/decimal by the runner; nothing here calls out.
 * Every unverified item is reported, never the first failure only.
 */
export function reviewRoutingGate({ ids = PROD_CHECK_IDS, principal, pushWorker, page, approval,
  services = [], routerConfig, identityConfig, checkedAt }) {
  const gaps = [];
  const add = (code, detail) => gaps.push({ code, detail });
  if (!checkedAt || !Number.isFinite(Date.parse(checkedAt))) throw new Error('Evidence timestamp required');
  const checkedAtMs = Math.floor(Date.parse(checkedAt) / 1000) * 1000;
  if (!page) { add('REGISTRY_UNREADABLE', 'A bounded consensus group registry reply is required.'); return finish(); }
  if (rows(page.next_cursor).length) add('REGISTRY_TRUNCATED', 'Registry exceeds this bounded audit; no whole-inventory claim.');
  const configurationRevision = decimal(rows(page.configuration_revision)[0]);
  if (!configurationRevision) add('CONFIGURATION_REVISION_MISSING', 'Router must expose its configuration revision.');
  const groups = rows(page.groups);
  if (!groups.length) add('NO_GROUPS_REGISTERED', 'No group is registered to approve.');
  const placements = new Map(rows(page.placements).map(p => [p.group_id, p]));
  if (placements.size !== rows(page.placements).length) add('DUPLICATE_PLACEMENT', 'A group has more than one placement.');
  const observed = new Map(services.map(s => [`${s.group}/${s.name}`, s]));
  const moduleHashes = {};

  for (const group of groups) {
    const placement = placements.get(group.id);
    if (group.accepting !== false) add('GROUP_OPEN', `${group.id}: group is accepting clubs; this gate is closed-only.`);
    if (group.target_alias !== 'mainnet') add('WRONG_TARGET', `${group.id}: unexpected target alias.`);
    if (!placement) { add('PLACEMENT_INCOMPLETE', `${group.id}: no placement registered.`); continue; }
    if (placement.host !== 'https://icp-api.io' || placement.network_kind !== 'public_mainnet' ||
        placement.deployment_id !== 'prod' || !decimal(placement.deployment_revision) ||
        decimal(placement.deployment_revision) === '0' || placement.additional_subnets_enabled !== false ||
        rows(placement.approved_subnets).length !== 1 || rows(placement.approved_subnets)[0] !== placement.primary_subnet)
      add('PLACEMENT_INCOMPLETE', `${group.id}: exact PROD HTTPS/network/single-subnet placement required.`);
    const expected = expectedServices(group, placement);
    if (expected.length !== GROUP_DOMAINS.length + 1) add('SERVICE_INVENTORY_INCOMPLETE', `${group.id}: 12 data services plus a photo store required.`);
    for (const item of expected) {
      const service = observed.get(`${group.id}/${item.name}`);
      if (!service || service.id !== item.id) { add('SERVICE_UNREADABLE', `${group.id}/${item.name}: management readback missing or differs from the registry.`); continue; }
      moduleHashes[`${group.id}/${item.name}`] = service.moduleHash;
      if (service.running !== true) add('SERVICE_NOT_RUNNING', `${group.id}/${item.name}: not running.`);
      if (rows(service.controllers).length !== 1 || rows(service.controllers)[0] !== principal)
        add('CONTROLLER_NOT_GOVERNOR', `${group.id}/${item.name}: sole controller must be the PROD governor.`);
      if (!item.subnet || service.subnet !== item.subnet) add('SUBNET_MISMATCH', `${group.id}/${item.name}: certified subnet differs from the placement.`);
      if (!isHex64(service.moduleHash)) add('MODULE_HASH_MISSING', `${group.id}/${item.name}: installed module hash unreadable.`);
      const cycles = decimal(service.cycles), heap = decimal(service.heapBytes);
      if (!cycles || !decimal(group.min_cycles) || BigInt(cycles) < BigInt(group.min_cycles))
        add('CYCLES_BELOW_MINIMUM', `${group.id}/${item.name}: cycles below the group minimum.`);
      if (!heap || !decimal(group.heap_budget_bytes) || BigInt(heap) >= BigInt(group.heap_budget_bytes))
        add('HEAP_AT_BUDGET', `${group.id}/${item.name}: heap at or above the group budget.`);
      if (envValue(service.environment, ADMISSION_FLAG) !== '1')
        add('REMOVAL_CHECKS_OFF', `${group.id}/${item.name}: account admission checks are off, so removals are not enforced.`);
      if (envValue(service.environment, ADMISSION_AUTHORITY) !== ids.identity_access)
        add('ADMISSION_AUTHORITY_MISSING', `${group.id}/${item.name}: not bound to the PROD account service.`);
      for (const peer of RECIPROCAL_LINKS[item.name] ?? []) {
        const peerId = expected.find(e => e.name === peer)?.id;
        if (!peerId) { add('RECIPROCAL_TARGET_MISSING', `${group.id}/${item.name}: ${peer} is not in this group.`); continue; }
        const observedValue = one(service.configuration, peer);
        if (observedValue === undefined) add('CONFIGURATION_ROW_MISSING', `${group.id}/${item.name}.${peer}: configuration row absent.`);
        else if (observedValue !== peerId) add('WRONG_RECIPROCAL_AUTHORITY', `${group.id}/${item.name}.${peer}: not the group's own service.`);
      }
    }
    const club = expected.find(e => e.name === 'club_domain'), store = expected.find(e => e.name === 'media_blob_store');
    const clubService = observed.get(`${group.id}/club_domain`);
    const queue = observed.get(`${group.id}/notification_queue`);
    const timer = observed.get(`${group.id}/timer_jobs`);
    const competition = observed.get(`${group.id}/competition_domain`);
    if (clubService && (one(clubService.configuration, 'identity_access') !== ids.identity_access ||
        !any(clubService.configuration, 'media_store', store?.id) ||
        !any(clubService.configuration, 'competition_authority', competition?.id)))
      add('CLUB_BINDINGS_INCOMPLETE', `${group.id}: club identity, media store or competition authority missing.`);
    if (competition && !any(competition.configuration, 'participant_club_authority', club?.id))
      add('COMPETITION_AUTHORITY_MISSING', `${group.id}: competition participant club authority missing.`);
    if (queue && one(queue.configuration, 'identity_access') !== ids.identity_access)
      add('NOTIFICATION_IDENTITY_MISSING', `${group.id}: notification queue is not bound to the PROD account service.`);
    if (!pushWorker || !/^[a-z0-9-]{5,63}$/.test(String(pushWorker))) add('PUSH_WORKER_UNPINNED', 'The PROD delivery identity must be named before approval.');
    else {
      if (queue && !any(queue.configuration, 'worker', pushWorker)) add('NOTIFICATION_WORKER_MISSING', `${group.id}: notification queue has not granted the PROD delivery identity.`);
      if (timer && !any(timer.configuration, 'worker:*', pushWorker)) add('TIMER_WORKER_MISSING', `${group.id}: timer jobs have not granted the PROD delivery identity.`);
    }
  }

  const routerAuthority = one(routerConfig, 'deletion_authority');
  if (routerAuthority !== ids.identity_access) add('ROUTER_DELETION_AUTHORITY_MISSING', 'Router deletion authority must be the PROD account service.');
  if (one(identityConfig, 'registry') !== ids.shard_router || one(identityConfig, 'target_alias') !== 'mainnet' ||
      one(identityConfig, 'deployment_id') !== 'prod' || one(identityConfig, 'host') !== 'https://icp-api.io' ||
      one(identityConfig, 'network_kind') !== 'public_mainnet')
    add('IDENTITY_REGISTRY_NOT_BOUND', 'Account service is not pinned to this independent PROD registry/deployment.');
  if (one(identityConfig, 'bound_deletion_released') !== 'true')
    add('DELETION_RELEASE_UNVERIFIED', 'Bound-deletion protocol has not read back as released.');
  const admissionServices = services.filter(s => envValue(s.environment, ADMISSION_FLAG) === '1');
  if (admissionServices.length) {
    if (one(identityConfig, 'account_admission_released') !== 'true')
      add('ADMISSION_RELEASE_UNVERIFIED', 'The account service has not released account admission; group settings alone cannot authorize membership reads.');
    for (const service of admissionServices)
      if (!rows(identityConfig).some(r => r[0] === 'eligibility_authority' && r[1] === service.id))
        add('ACCOUNT_ELIGIBILITY_READER_UNAUTHORIZED', `${service.group}/${service.name}: the account service does not authorize this reader.`);
  }

  const groupIds = groups.map(g => g.id).sort();
  if (!approval) add('ROUTING_APPROVAL_MISSING', 'No PROD routing approval recorded.');
  else if (approval.target_alias !== 'mainnet' || decimal(approval.configuration_revision) !== configurationRevision ||
      !isHex64(approval.approved_configuration_sha256) || !isHex64(approval.evidence_sha256) ||
      !decimal(approval.removal_checked_at_ms) || decimal(approval.removal_checked_at_ms) === '0' ||
      JSON.stringify([...approval.removal_wiring_group_ids].sort()) !== JSON.stringify(groupIds))
    add('ROUTING_APPROVAL_STALE', 'The recorded approval does not match configuration revision and the complete group inventory.');

  function finish() {
    const configText = groups.length && placements.size === groups.length ? safeConfig(groups, placements) : '';
    const evidence = { registryRevision: decimal(page?.revision), configurationRevision,
      groups: groups.map(g => ({ id: g.id, domains: rows(g.domains).map(d => ({ domain: d.domain, canisterId: d.canister })),
        photoStore: rows(g.photo_store)[0] ?? null,
        moduleHashes: Object.fromEntries(Object.entries(moduleHashes).filter(([k]) => k.startsWith(`${g.id}/`)).map(([k, v]) => [k.slice(g.id.length + 1), v])) })),
      approvedConfiguration: configText,
      removalWiring: { revision: configurationRevision, groupIds, checkedAtMs }, generatedAt: checkedAt };
    const evidenceSha256 = sha256Hex(JSON.stringify(evidence));
    const gateComplete = gaps.length === 0 && groups.length > 0 && groups.every(g => g.accepting === false);
    return { gateComplete, openingAuthorized: false, admissionAuthorized: false, approvalRecorded: false,
      configurationRevision, groupIds, evidence, evidenceSha256, gaps,
      approvalDraft: gateComplete && configText ? {
        target_alias: 'mainnet', configuration_revision: configurationRevision,
        approved_configuration_sha256: sha256Hex(configText), removal_wiring_group_ids: groupIds,
        removal_checked_at_ms: checkedAtMs, evidence_sha256: evidenceSha256,
      } : null,
      limits: ['Read-only review: records nothing and opens nothing.',
        'Module hashes are read live; attestation against reviewed WASM remains separate.',
        'Only a governor-signed router approval call, reviewed separately, may record this.'] };
  }
  return finish();
}

function safeConfig(groups, placements) {
  try { return groupApprovalConfiguration(groups, [...placements.values()]); }
  catch { return ''; }
}

export function routingGateSummary(review) {
  return ['### PROD routing gate (read-only)', '',
    `Configuration revision: \`${review.configurationRevision ?? 'unreadable'}\` · groups: ${review.groupIds.join(', ') || 'none'}`, '',
    ...(review.gaps.length ? review.gaps.map(g => `- ${g.code}: ${g.detail}`) : ['- All bounded wiring checks passed.']),
    '',
    review.approvalDraft ? `Approval a governor could record at revision ${review.approvalDraft.configuration_revision}: ` +
      `configuration digest \`${review.approvalDraft.approved_configuration_sha256}\`, evidence \`${review.approvalDraft.evidence_sha256}\`.`
      : 'No approval may be recorded yet: every gap above must close first.',
    'Groups stay closed; this review opens nothing, records nothing and authorizes no admission.',
    'No funding, deployments, DEV or database changes were made.'].join('\n') + '\n';
}

// Only locally defined labels are public; arbitrary agent/API text never leaks.
export function gateFailureReason(error) {
  const message = error instanceof Error ? error.message : '';
  const known = ['Evidence timestamp required', 'Only read-only check is supported',
    'Connection check requires the live repository prod branch',
    'Connection check requires the exact recorded 18-service PROD inventory',
    'PROD governor principal mismatch'];
  if (known.includes(message)) return message;
  if (/^(Connection check requires|PROD must not|Governor principal|Repository variable)/.test(message)) return message.slice(0, 200);
  if (/magic number|IDL|decode|type/i.test(message)) return 'Reply could not be decoded';
  return 'Routing gate stopped; inspect the saved report without retrying';
}
