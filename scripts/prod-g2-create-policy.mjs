// Pure policy for closed PROD second-group (g2) creation. No network, no CLI.
// The group is created, installed, configured and health-checked, then stopped
// CLOSED: never registered in the router, never opened, never given clubs.
import { assertCheckContext, PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';
import { canonical, hashPlan, normalizeReviewedHash } from './prod-base-group-policy.mjs';
import { NEW_GROUP_PHOTO_STORE_GIB, capacityBytesFor } from './enlarge-photo-store-policy.mjs';

export const G2_SERVICES = Object.freeze([...GROUP_DOMAINS, 'media_blob_store']);
export const G2_CREATE_CONFIRMATION = 'CREATE PROD G2 CLOSED';
export const G2_CYCLES_PER_CANISTER = 1_500_000_000_000n;
export const G2_LEDGER_FEE = 100_000_000_000n;
export const G2_RECEIPT_PATH = 'prod-group-setup/g2.json';
/** Cycles ledger dedup window is 24h; older create intents need manual reconciliation. */
export const CREATE_DEDUP_WINDOW_NS = 23n * 3600n * 1_000_000_000n;
export const G2_PHOTO_STORE_BYTES = capacityBytesFor(NEW_GROUP_PHOTO_STORE_GIB);

export function assertG2Context(ids, env, principal, action) {
  assertCheckContext(ids, env, principal);
  if (!['plan', 'inspect', 'create-closed'].includes(action))
    throw new Error('Only plan, inspect or create-closed supported');
  if (action === 'create-closed' && env.CONFIRMATION?.trim() !== G2_CREATE_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${G2_CREATE_CONFIRMATION}`);
}

const decimal = (value, label) => {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error(`Invalid ${label}`);
  return BigInt(value);
};
const immutableGroup = g => {
  const { heap_bytes, cycles, observed_at_ns, ...configuration } = g;
  return configuration;
};
const PRINCIPAL_TEXT = /^[a-z0-9-]{5,63}$/;

/**
 * Ordered wiring recipe, ported from groupConfigurationPlan (DEV-tested).
 * Args reference service names; 'push_worker' and 'identity_access' are the
 * shared globals. A nested array means a vec principal argument.
 */
export const CONFIGURATION_RECIPE = Object.freeze([
  ['media_blob_store', 'set_club_domain_canister', ['club_domain']],
  ['club_domain', 'register_media_quota_store', ['media_blob_store']],
  ['vault_domain', 'set_vault_stores', [['media_blob_store']]],
  ['media_blob_store', 'set_vault_authority', ['vault_domain']],
  ['timer_jobs', 'grant_worker', ['push_worker']],
  ...['pii_access_control', 'vault_domain', 'club_points_domain', 'messaging_domain',
    'notification_queue', 'events_domain', 'competition_domain', 'mini_league_domain']
    .map(d => [d, 'set_club_domain_canister', ['club_domain']]),
  ...['messaging_domain', 'club_domain', 'events_domain']
    .map(d => [d, 'set_notification_queue_canister', ['notification_queue']]),
  ['media_metadata', 'set_gallery_authorities', ['club_domain', 'vault_domain']],
  ['club_domain', 'set_gallery_media_authority', ['media_metadata']],
  ['vault_domain', 'set_gallery_media_authority', ['media_metadata']],
  ['vault_domain', 'set_messaging_domain_canister', ['messaging_domain']],
  ['messaging_domain', 'set_vault_domain_canister', ['vault_domain']],
  ['notification_queue', 'set_messaging_domain_canister', ['messaging_domain']],
  ['notification_queue', 'set_identity_access_canister', ['identity_access']],
  ['notification_queue', 'grant_worker', ['push_worker']],
  ['club_domain', 'set_events_domain_canister', ['events_domain']],
  ['club_domain', 'set_messaging_domain_canister', ['messaging_domain']],
  ['club_domain', 'set_pii_canister', ['pii_access_control']],
  ['club_domain', 'set_mini_league_domain_canister', ['mini_league_domain']],
  ['club_domain', 'set_competition_domain_canister', ['competition_domain']],
  ['club_domain', 'set_competition_authorities', [['competition_domain']]],
  ['competition_domain', 'set_participant_club_authorities', [['club_domain']]],
  ...['pii_access_control', 'vault_domain', 'messaging_domain', 'events_domain']
    .map(d => [d, 'set_competition_domain_canister', ['competition_domain']]),
  ['competition_domain', 'set_events_domain_canister', ['events_domain']],
  ['competition_domain', 'set_vault_domain_canister', ['vault_domain']],
  ['competition_domain', 'set_pii_access_control_canister', ['pii_access_control']],
  ['events_domain', 'set_mini_league_domain_canister', ['mini_league_domain']],
  ['mini_league_domain', 'set_events_domain_canister', ['events_domain']],
]);

/** Resolves the recipe against created canister IDs. Pure validation; no calls. */
export function g2ConfigurationBinding(plan, canisters) {
  const ids = G2_SERVICES.map(name => canisters[name]);
  if (ids.some(id => !id || !PRINCIPAL_TEXT.test(id))) throw new Error('Incomplete g2 inventory');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate g2 canister');
  const globals = { identity_access: plan.sharedInfrastructure.identity_access, push_worker: plan.pushWorker };
  for (const [label, id] of Object.entries(globals)) {
    if (!id || !PRINCIPAL_TEXT.test(id) || id === 'aaaaa-aa') throw new Error(`Invalid ${label} principal`);
    if (ids.includes(id)) throw new Error(`Global ${label} duplicated in group`);
  }
  if (globals.identity_access === globals.push_worker) throw new Error('Global identity and worker must differ');
  const resolve = name => {
    if (name in globals) return globals[name];
    if (!canisters[name]) throw new Error(`Missing configuration principal: ${name}`);
    return canisters[name];
  };
  return CONFIGURATION_RECIPE.map(([domain, method, args]) => ({
    domain, method, name: `${domain}.${method}`,
    canisterId: domain === 'media_blob_store' ? canisters.media_blob_store : canisters[domain],
    args: args.map(a => Array.isArray(a) ? a.map(resolve) : resolve(a)),
  }));
}

export function buildG2CreationPlan({ ids, env, principal, baseReceipt, page, observations, wasmHashes, pushWorker, balance, checkedAt }) {
  assertCheckContext(ids, env, principal);
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('Exact source commit required');
  if (!checkedAt || !Number.isFinite(Date.parse(checkedAt))) throw new Error('Evidence timestamp required');
  if (baseReceipt?.phase !== 'registered-closed' || baseReceipt.pending !== null ||
      !baseReceipt.plan || baseReceipt.planHash !== hashPlan(baseReceipt.plan) ||
      baseReceipt.plan.principal !== principal || baseReceipt.plan.openingAuthorized !== false ||
      baseReceipt.plan.lifecycleReleaseAuthorized !== false) throw new Error('Confirmed closed base receipt required');
  if (page?.next_cursor?.length || page?.groups?.length !== 1 || page?.placements?.length !== 1)
    throw new Error('Complete base-only registry required; existing or unknown g2 needs separate review');
  const group = page.groups[0], placement = page.placements[0];
  if (group.id !== 'base' || group.accepting !== false || group.assigned_clubs !== 0 ||
      canonical(immutableGroup(group)) !== canonical(immutableGroup(baseReceipt.plan.group)) ||
      canonical(placement) !== canonical(baseReceipt.plan.placement))
    throw new Error('Live closed base configuration differs from reviewed receipt');
  if (placement.deployment_id !== 'prod' || placement.host !== 'https://icp-api.io' ||
      placement.network_kind !== 'public_mainnet' || placement.additional_subnets_enabled ||
      placement.approved_subnets?.length !== 1 || placement.primary_subnet !== placement.approved_subnets[0])
    throw new Error('Exact single-subnet PROD placement required');
  const names = Object.keys(PROD_CHECK_IDS).sort();
  if (!Array.isArray(observations) || observations.length !== names.length || new Set(observations.map(o => o.name)).size !== names.length)
    throw new Error('Complete certified PROD infrastructure evidence required');
  const certified = names.map(name => {
    const o = observations.find(o => o.name === name);
    if (!o || o.id !== ids[name] || !/^[a-f0-9]{64}$/.test(o.moduleHash ?? '') ||
        o.controllers?.length !== 1 || o.controllers[0] !== principal || o.subnet !== placement.primary_subnet)
      throw new Error('Certified PROD infrastructure mismatch');
    return { name, id: o.id, moduleHash: o.moduleHash, controllers: o.controllers, subnet: o.subnet };
  });
  // The second group runs exactly the modules the base group runs; a rebuilt
  // artifact that differs means the source moved and the build must be reviewed.
  const services = G2_SERVICES.map(name => {
    const built = wasmHashes?.[name];
    const observed = certified.find(o => o.name === name)?.moduleHash;
    if (!/^[a-f0-9]{64}$/.test(built ?? '')) throw new Error(`Missing built module hash for ${name}`);
    if (built !== observed)
      throw new Error(`Built ${name} module differs from the certified base module; review the source change first`);
    return { name, canisterId: null, moduleHash: built };
  });
  if (!PRINCIPAL_TEXT.test(pushWorker ?? '') || pushWorker === 'aaaaa-aa' ||
      Object.values(ids).includes(pushWorker))
    throw new Error('Valid existing push worker principal required');
  const available = decimal(balance, 'account balance');
  const required = BigInt(G2_SERVICES.length) * (G2_CYCLES_PER_CANISTER + G2_LEDGER_FEE);
  if (available < required)
    throw new Error('Signing account balance below the estimated creation requirement; fund before creating');
  return { version: 1, purpose: 'Create independent PROD g2 CLOSED only; never registers or opens',
    sourceCommit: env.GITHUB_SHA, checkedAt, principal, groupId: 'g2', deploymentId: 'prod',
    targetAlias: 'mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet',
    primarySubnet: placement.primary_subnet, additionalSubnetsEnabled: false,
    baseReceiptHash: hashPlan(baseReceipt), basePlanHash: baseReceipt.planHash,
    services, sharedInfrastructure: { identity_access: ids.identity_access }, pushWorker,
    cyclesPerCanister: G2_CYCLES_PER_CANISTER.toString(),
    photoStoreBytes: G2_PHOTO_STORE_BYTES.toString(),
    configurationRecipe: CONFIGURATION_RECIPE.map(([domain, method]) => `${domain}.${method}`),
    funding: { account: { owner: principal, subaccount: null }, balanceCycles: available.toString(),
      estimatedRequiredCycles: required.toString(), exactQuote: false,
      note: 'Retained fuel is not a consumed fee. Actual spend is rechecked per step.' },
    executable: false, registrationAuthorized: false, openingAuthorized: false, lifecycleReleaseAuthorized: false,
  };
}

// checkedAt and the observed balance change on every run; everything else must
// match the reviewed plan exactly. The live balance is still enforced separately:
// buildG2CreationPlan refuses to build a plan when funds are below the requirement.
const stableG2Plan = p => {
  const { checkedAt, funding, ...rest } = p;
  const { balanceCycles, ...fundingRest } = funding ?? {};
  return { ...rest, funding: fundingRest };
};
export function assertReviewedG2Plan(plan, rawExpectedHash, currentPlan) {
  const expectedHash = normalizeReviewedHash(rawExpectedHash);
  if (!/^[a-f0-9]{64}$/.test(expectedHash))
    throw new Error('Reviewed plan hash required (64 lowercase hex characters)');
  if (hashPlan(plan) !== expectedHash)
    throw new Error('Reviewed plan hash does not match the saved g2 receipt');
  if (hashPlan(stableG2Plan(plan)) !== hashPlan(stableG2Plan(currentPlan)))
    throw new Error('Live inventory, modules, controller, subnet, worker or source changed; re-plan');
  if (plan.registrationAuthorized !== false || plan.openingAuthorized !== false ||
      plan.lifecycleReleaseAuthorized !== false)
    throw new Error('Closed-only plan required');
}

/**
 * Checkpointed creation state machine. Every external mutation is preceded by a
 * durable acknowledged intent and is idempotent: create dedups on the ledger
 * timestamp persisted before the call, install skips an identical module and
 * refuses a foreign one, configuration setters are replayable. A pending intent
 * survives runner loss and is resumed, never blindly replayed.
 */
export async function runG2Creation({ plan, receipt, checkpoint, calls, nowNs }) {
  if (receipt.pending) throw new Error('Unresolved intent; reconcile without replay');
  const resumable = ['planned', 'creating', 'created', 'installed', 'configured', 'checked'];
  // Verify the stored receipt's own integrity: receipt.plan is the reviewed plan
  // (assertReviewedG2Plan already matched it against the entered hash and compared
  // the stable fields against the current run). Hashing the fresh `plan` here can
  // never match, because it embeds the current balance and timestamp.
  if (!resumable.includes(receipt.phase) || receipt.planHash !== hashPlan(receipt.plan))
    throw new Error('Reviewed g2 plan receipt required');
  if (receipt.phase === 'sized') throw new Error('Group already created; this tool never touches a completed group');
  const baseIds = new Set(Object.values(PROD_CHECK_IDS));
  const own = id => { if (baseIds.has(id)) throw new Error('Refusing existing PROD base canister'); };
  let current = { ...receipt, phase: 'creating', canisters: receipt.canisters ?? {},
    installedDomains: receipt.installedDomains ?? [], observedSubnets: receipt.observedSubnets ?? {},
    dedicatedBlobStore: receipt.dedicatedBlobStore ?? null, configuration: receipt.configuration ?? null };
  const save = async next => { current = next; await checkpoint(current); };

  // Phase 1: create the 13 services on the approved subnet.
  for (const { name } of plan.services) {
    if (current.canisters[name]) continue; // resume: never create twice
    const operation = nowNs().toString();
    await save({ ...current, pending: { kind: 'create', domain: name, operation } });
    const created = await calls.createCanister({ createdAtNs: BigInt(operation), amount: G2_CYCLES_PER_CANISTER,
      subnetId: plan.primarySubnet, controllers: [plan.principal] });
    const canisterId = created.canisterId ?? created.duplicateOf;
    own(canisterId);
    if (Object.values(current.canisters).includes(canisterId)) throw new Error('Duplicate g2 canister');
    const subnet = await calls.subnetOf(canisterId);
    await save({ ...current, pending: null,
      canisters: { ...current.canisters, [name]: canisterId },
      observedSubnets: { ...current.observedSubnets, [name]: subnet } });
    if (subnet !== plan.primarySubnet) throw new Error(`${name} landed on unapproved subnet; stop without replay`);
  }
  await save({ ...current, phase: 'created' });

  // Phase 2: install the reviewed modules.
  for (const { name, moduleHash } of plan.services) {
    if (current.installedDomains.includes(name)) continue;
    const id = current.canisters[name];
    await save({ ...current, pending: { kind: 'install', domain: name } });
    const status = await calls.status(id);
    if (!status.controllers.includes(plan.principal)) throw new Error(`Governor does not control ${name}`);
    if (status.moduleHash && status.moduleHash !== moduleHash)
      throw new Error(`${name} holds a different module; refusing to overwrite`);
    if (!status.moduleHash) {
      const env = calls.environment(name);
      if (env.length) await calls.setEnvironment(id, env);
      await calls.installChunked(id, calls.wasm(name), calls.initArg(name));
    }
    await save({ ...current, pending: null, installedDomains: [...current.installedDomains, name] });
  }
  await save({ ...current, phase: 'installed' });

  // Phase 3: reciprocal configuration, one acknowledged operation at a time.
  const operations = g2ConfigurationBinding(plan, current.canisters);
  const binding = canonical({ planHash: receipt.planHash, canisters: current.canisters,
    globals: { identity_access: plan.sharedInfrastructure.identity_access, push_worker: plan.pushWorker } });
  if (current.configuration && current.configuration.binding !== binding)
    throw new Error('Configuration binding changed; stop without replay');
  const names = operations.map(op => op.name);
  const completed = current.configuration?.completed ?? [];
  if (new Set(completed).size !== completed.length || completed.some(n => !names.includes(n)))
    throw new Error('Invalid configuration receipts');
  await save({ ...current, configuration: { binding, completed: [...completed] } });
  for (const op of operations) {
    if (current.configuration.completed.includes(op.name)) continue;
    await save({ ...current, pending: { kind: 'configure', domain: op.domain, operation: op.name } });
    await calls.configure(op.domain, op.canisterId, op.method, op.args);
    await save({ ...current, pending: null,
      configuration: { binding, completed: [...current.configuration.completed, op.name] } });
  }
  await save({ ...current, phase: 'configured' });

  // Phase 4: health — every service running, governor-controlled, exact module, fueled.
  for (const { name, moduleHash } of plan.services) {
    const id = current.canisters[name];
    const status = await calls.status(id);
    if (!status.running || !status.controllers.includes(plan.principal) || status.moduleHash !== moduleHash)
      throw new Error(`${name} failed health check`);
    if ((await calls.cyclesOf(id)) <= 0n) throw new Error(`${name} failed health check`);
  }
  await save({ ...current, phase: 'checked' });

  // Phase 5: full-size group-owned photo store (empty store, no copy-over).
  const blob = current.canisters.media_blob_store;
  if (!(await calls.blobStableEnabled(blob))) {
    await save({ ...current, pending: { kind: 'configure', domain: 'media_blob_store', operation: 'media_blob_store.enable_stable_media_storage' } });
    await calls.blobEnableStable(blob);
    await save({ ...current, pending: null });
  }
  const applied = await calls.blobCapacity(blob);
  if (applied < BigInt(plan.photoStoreBytes)) {
    await save({ ...current, pending: { kind: 'configure', domain: 'media_blob_store', operation: 'media_blob_store.set_capacity_limit' } });
    await calls.blobSetCapacity(blob, BigInt(plan.photoStoreBytes));
    await save({ ...current, pending: null });
    if ((await calls.blobCapacity(blob)) < BigInt(plan.photoStoreBytes))
      throw new Error('Photo store size did not reach the planned capacity; stop without replay');
  }
  await save({ ...current, phase: 'sized', pending: null });
  return { createdClosed: true, registrationAuthorized: false, openingAuthorized: false,
    canisters: current.canisters, photoStoreBytes: plan.photoStoreBytes };
}

/**
 * Resumes a single unresolved create/install intent through the idempotent
 * adapters. Configure intents resume inside runG2Creation (setters replay
 * safely); anything else stops for manual review.
 */
export async function resumeG2Intent({ plan, receipt, checkpoint, calls, nowNs }) {
  const pending = receipt.pending;
  if (!pending) return receipt;
  if (pending.kind === 'configure') return { ...receipt, pending: null };
  if (pending.kind === 'create') {
    if (receipt.canisters?.[pending.domain]) throw new Error('Create intent inconsistent with recorded canister');
    const createdAtNs = BigInt(pending.operation ?? '0');
    if (nowNs() - createdAtNs > CREATE_DEDUP_WINDOW_NS)
      throw new Error('Create intent older than the ledger dedup window; reconcile by hand');
    const created = await calls.createCanister({ createdAtNs, amount: G2_CYCLES_PER_CANISTER,
      subnetId: plan.primarySubnet, controllers: [plan.principal] });
    const canisterId = created.canisterId ?? created.duplicateOf;
    if (Object.values(PROD_CHECK_IDS).includes(canisterId)) throw new Error('Refusing existing PROD base canister');
    const subnet = await calls.subnetOf(canisterId);
    const next = { ...receipt, pending: null,
      canisters: { ...receipt.canisters, [pending.domain]: canisterId },
      observedSubnets: { ...receipt.observedSubnets, [pending.domain]: subnet } };
    await checkpoint(next);
    if (subnet !== plan.primarySubnet) throw new Error(`${pending.domain} landed on unapproved subnet; stop without replay`);
    return next;
  }
  if (pending.kind === 'install') {
    const id = receipt.canisters?.[pending.domain];
    if (!id) throw new Error('Install intent for uncreated service');
    const moduleHash = plan.services.find(s => s.name === pending.domain)?.moduleHash;
    const status = await calls.status(id);
    if (status.moduleHash && status.moduleHash !== moduleHash)
      throw new Error(`${pending.domain} holds a different module; refusing to overwrite`);
    if (!status.moduleHash) {
      const env = calls.environment(pending.domain);
      if (env.length) await calls.setEnvironment(id, env);
      await calls.installChunked(id, calls.wasm(pending.domain), calls.initArg(pending.domain));
    }
    const next = { ...receipt, pending: null,
      installedDomains: [...new Set([...(receipt.installedDomains ?? []), pending.domain])] };
    await checkpoint(next);
    return next;
  }
  throw new Error('Unknown pending intent; reconcile by hand');
}

export function g2PlanSummary(plan) {
  const trillions = value => `${BigInt(value) / 1_000_000_000_000n}T`;
  return ['### PROD second group — creation plan (review only)', '',
    `Reviewed-plan hash: \`${hashPlan(plan)}\``, '',
    `13 NEW independent services on subnet ${plan.primarySubnet}, each running the exact certified base module.`,
    `Push worker: ${plan.pushWorker}. Shared identity service: ${plan.sharedInfrastructure.identity_access}.`,
    `Fuel per service: ${trillions(plan.cyclesPerCanister)}. Estimated requirement: ${trillions(plan.funding.estimatedRequiredCycles)}. Balance: ${trillions(plan.funding.balanceCycles)}.`,
    `Group-owned photo store will be set to ${plan.photoStoreBytes} bytes at install.`,
    'No payment, creation, configuration, registration, opening, database or DEV changes were made.',
    'The group stays CLOSED: router registration, routing approval and admission remain separate reviewed steps.', ''].join('\n');
}
