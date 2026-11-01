// Pure review policy for registering the already-created PROD g2 CLOSED in the
// router. It never opens a group, never admits a club and never touches DEV.
// Separate from the creation receipt: creation is finished and immutable, so
// registration carries its own durable journal and its own reviewed hash.
import { assertCheckContext, PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';
import { canonical, hashPlan, normalizeReviewedHash } from './prod-base-group-policy.mjs';
import { CONFIGURATION_RECIPE, G2_SERVICES } from './prod-g2-create-policy.mjs';

export const G2_REGISTER_CONFIRMATION = 'REGISTER PROD G2 CLOSED';
export const G2_READBACK_CONFIRMATION = 'CONFIRM PROD G2 READBACK';
export const G2_REGISTRATION_RECEIPT_PATH = 'prod-group-setup/g2-registration.json';

export function assertG2RegistrationContext(ids, env, principal, action) {
  assertCheckContext(ids, env, principal);
  if (!['plan', 'inspect', 'register-closed', 'reconcile-readback'].includes(action))
    throw new Error('Only plan, inspect, register-closed or reconcile-readback supported');
  if (action === 'register-closed' && env.CONFIRMATION?.trim() !== G2_REGISTER_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${G2_REGISTER_CONFIRMATION}`);
  if (action === 'reconcile-readback' && env.CONFIRMATION?.trim() !== G2_READBACK_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${G2_READBACK_CONFIRMATION}`);
}

const decimal = (value, label) => {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error(`Invalid ${label}`);
  return BigInt(value);
};
const immutableGroup = g => {
  const { heap_bytes, cycles, observed_at_ns, ...configuration } = g;
  return configuration;
};

/**
 * Builds the closed registration proposal from three independently certified
 * inputs: the confirmed closed base receipt, the finished g2 creation receipt,
 * and the live registry plus certified g2 canister evidence. Any drift in any
 * of them stops planning, so a reviewed hash always describes one exact state.
 */
export function buildG2RegistrationPlan({ ids, env, principal, baseReceipt, g2Receipt, page, observations, budgets, checkedAt }) {
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('Exact source commit required');
  if (!checkedAt || !Number.isFinite(Date.parse(checkedAt))) throw new Error('Evidence timestamp required');
  if (baseReceipt?.phase !== 'registered-closed' || baseReceipt.pending !== null ||
      !baseReceipt.plan || baseReceipt.planHash !== hashPlan(baseReceipt.plan) ||
      baseReceipt.plan.principal !== principal || baseReceipt.plan.openingAuthorized !== false ||
      baseReceipt.plan.lifecycleReleaseAuthorized !== false) throw new Error('Confirmed closed base receipt required');
  if (g2Receipt?.phase !== 'sized' || g2Receipt.pending !== null || !g2Receipt.plan ||
      g2Receipt.planHash !== hashPlan(g2Receipt.plan) || g2Receipt.plan.principal !== principal ||
      g2Receipt.plan.registrationAuthorized !== false || g2Receipt.plan.openingAuthorized !== false ||
      g2Receipt.plan.lifecycleReleaseAuthorized !== false) throw new Error('Confirmed closed g2 creation receipt required');
  const canisters = g2Receipt.canisters ?? {};
  const created = G2_SERVICES.map(name => canisters[name]);
  if (created.some(id => !id) || new Set(created).size !== created.length) throw new Error('Complete independent g2 inventory required');
  if (created.some(id => Object.values(PROD_CHECK_IDS).includes(id))) throw new Error('g2 must not reuse an existing PROD base canister');
  if ((g2Receipt.installedDomains ?? []).length !== G2_SERVICES.length) throw new Error('Every g2 service must hold its reviewed module');
  if ((g2Receipt.configuration?.completed ?? []).length !== CONFIGURATION_RECIPE.length) throw new Error('Every g2 wiring operation must be complete');
  if (g2Receipt.configuration.binding !== canonical(g2Receipt.configuration.binding === undefined ? {} : g2Receipt.configuration.binding))
    throw new Error('g2 configuration binding unreadable');
  const registryIds = [...GROUP_DOMAINS.map(n => canisters[n]), canisters.media_blob_store];
  if (registryIds.some(id => Object.values(PROD_CHECK_IDS).includes(id))) throw new Error('g2 data canisters must be independent of base');
  if (page?.next_cursor?.length || page?.groups?.length !== 1 || page?.placements?.length !== 1)
    throw new Error('Complete base-only registry required; an existing g2 needs separate review');
  const baseGroup = page.groups[0], basePlacement = page.placements[0];
  if (baseGroup.id !== 'base' || baseGroup.accepting !== false || baseGroup.assigned_clubs !== 0 ||
      canonical(immutableGroup(baseGroup)) !== canonical(immutableGroup(baseReceipt.plan.group)) ||
      canonical(basePlacement) !== canonical(baseReceipt.plan.placement)) throw new Error('Live closed base configuration differs from reviewed receipt');
  const revision = decimal(page.revision, 'registry revision');
  const configurationRevision = decimal(page.configuration_revision?.[0], 'configuration revision');
  if (revision < decimal(baseReceipt.placementRevision, 'base receipt revision'))
    throw new Error('Registry revision predates confirmed base');
  if (basePlacement.deployment_id !== 'prod' || basePlacement.host !== 'https://icp-api.io' ||
      basePlacement.network_kind !== 'public_mainnet' || basePlacement.additional_subnets_enabled ||
      basePlacement.approved_subnets?.length !== 1 || basePlacement.primary_subnet !== basePlacement.approved_subnets[0])
    throw new Error('Exact single-subnet PROD placement required');
  const subnet = basePlacement.primary_subnet;
  const names = G2_SERVICES;
  if (!Array.isArray(observations) || observations.length !== names.length ||
      new Set(observations.map(o => o.name)).size !== names.length) throw new Error('Complete certified g2 evidence required');
  const certified = names.map(name => {
    const o = observations.find(o => o.name === name);
    const reviewed = g2Receipt.plan.services.find(s => s.name === name);
    if (!o || o.id !== canisters[name] || !/^[a-f0-9]{64}$/.test(o.moduleHash ?? '') ||
        o.controllers?.length !== 1 || o.controllers[0] !== principal || o.subnet !== subnet ||
        o.moduleHash !== reviewed?.moduleHash) throw new Error(`Certified g2 evidence mismatch: ${name}`);
    return { name, id: o.id, moduleHash: o.moduleHash, controllers: o.controllers, subnet: o.subnet };
  });
  const maxClubs = decimal(budgets.maxClubs, 'max clubs');
  const minCycles = decimal(budgets.minCycles, 'minimum cycles');
  const heapBudget = decimal(budgets.heapBudgetBytes, 'heap budget');
  if (maxClubs < 1n || maxClubs > 100000n || minCycles < 1n || minCycles > (1n << 64n) - 1n ||
      heapBudget < 1n || heapBudget > 3221225472n) throw new Error('Router budgets out of bounds');
  const domainNames = [...GROUP_DOMAINS, 'secret_workload_identity'];
  const shared = { secret_workload_identity: ids.secret_workload_identity };
  if (Object.values(shared).some(id => registryIds.includes(id))) throw new Error('Shared workload identity must not be a group data canister');
  const group = { id: 'g2', target_alias: 'mainnet', accepting: false,
    domains: domainNames.map(domain => ({ domain, canister: domain in shared ? shared[domain] : canisters[domain] })),
    photo_store: [canisters.media_blob_store], max_clubs: Number(maxClubs), assigned_clubs: 0,
    min_cycles: minCycles.toString(), heap_budget_bytes: heapBudget.toString(), heap_bytes: '0', cycles: '0', observed_at_ns: '0' };
  const placement = { group_id: 'g2', deployment_id: 'prod', deployment_revision: '1', host: 'https://icp-api.io',
    network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet], additional_subnets_enabled: false,
    domains: group.domains.map(d => ({ ...d, subnet })) };
  return { version: 1, purpose: 'Register the created PROD g2 CLOSED only; never opens or admits clubs',
    sourceCommit: env.GITHUB_SHA, checkedAt, principal, groupId: 'g2', deploymentId: 'prod',
    targetAlias: 'mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet',
    primarySubnet: subnet, additionalSubnetsEnabled: false,
    baseReceiptHash: hashPlan(baseReceipt), basePlanHash: baseReceipt.planHash,
    g2CreationPlanHash: g2Receipt.planHash, g2CreationReceiptHash: hashPlan(g2Receipt),
    registryRevision: revision.toString(), configurationRevision: configurationRevision.toString(),
    expectedRevision: revision.toString(), services: certified, group, placement,
    budgets: { maxClubs: maxClubs.toString(), minCycles: minCycles.toString(), heapBudgetBytes: heapBudget.toString() },
    executable: false, registrationAuthorized: false, openingAuthorized: false, lifecycleReleaseAuthorized: false, admissionAuthorized: false };
}

/** The reviewed hash covers everything except the run timestamp, so a later
 * run of the same code still matches, while any real inventory/registry change
 * forces a fresh plan. The live state is re-read and compared on every run. */
const stableG2RegistrationPlan = p => { const { checkedAt, ...rest } = p; return rest; };
export function assertReviewedG2RegistrationPlan(plan, rawExpectedHash, currentPlan) {
  const expectedHash = normalizeReviewedHash(rawExpectedHash);
  if (!/^[a-f0-9]{64}$/.test(expectedHash))
    throw new Error('Reviewed plan hash required (64 lowercase hex characters)');
  if (hashPlan(plan) !== expectedHash)
    throw new Error('Reviewed plan hash does not match the saved g2 registration receipt');
  if (hashPlan(stableG2RegistrationPlan(plan)) !== hashPlan(stableG2RegistrationPlan(currentPlan)))
    throw new Error('Live inventory, modules, controller, subnet or registry revision changed; re-plan');
  if (plan.group.accepting !== false || plan.openingAuthorized !== false ||
      plan.lifecycleReleaseAuthorized !== false || plan.admissionAuthorized !== false)
    throw new Error('Closed-only plan required');
}

/** Checkpointed registration: every call is preceded by an acknowledged intent
 * and CAS'd on the exact reviewed revision. A pending intent forbids replay;
 * reconciliation completes only the final read-back. */
export async function registerClosedG2({ plan, receipt, checkpoint, registerGroup, registerPlacement, readRegistry }) {
  if (receipt.pending) throw new Error('Unresolved intent; reconcile without replay');
  if (receipt.phase !== 'planned' || receipt.planHash !== hashPlan(plan) || plan.group.accepting !== false)
    throw new Error('Reviewed closed g2 registration receipt required');
  let current = { ...receipt, pending: 'register_group' };
  await checkpoint(current);
  const groupRevision = await registerGroup(plan.group, BigInt(plan.expectedRevision));
  if (groupRevision !== BigInt(plan.expectedRevision) + 1n) throw new Error('Unexpected registration revision; stop without replay');
  current = { ...current, groupRevision: groupRevision.toString(), pending: 'register_group_placement' };
  await checkpoint(current);
  const placedRevision = await registerPlacement(plan.placement, groupRevision);
  if (placedRevision !== groupRevision + 1n) throw new Error('Unexpected placement revision; stop without replay');
  current = { ...current, placementRevision: placedRevision.toString(), pending: 'readback' };
  await checkpoint(current);
  assertClosedG2Readback(await readRegistry(placedRevision), plan, placedRevision);
  await checkpoint({ ...current, pending: null, phase: 'registered-closed' });
  return { registeredClosed: true, openingAuthorized: false, admissionAuthorized: false, revision: placedRevision.toString() };
}

/** Read-back must show the closed base exactly as reviewed *and* the closed g2
 * exactly as reviewed: two groups, two placements, nothing else. */
export function assertClosedG2Readback(page, plan, revision) {
  const basePlan = plan.basePlan;
  if (!basePlan) throw new Error('Reviewed base plan required for g2 readback');
  if (page.next_cursor?.length || String(page.revision) !== String(revision) ||
      page.groups?.length !== 2 || page.placements?.length !== 2 ||
      page.groups.some(g => g.accepting !== false) ||
      canonical(immutableGroup(page.groups.find(g => g.id === 'base'))) !== canonical(immutableGroup(basePlan.group)) ||
      canonical(page.placements.find(p => p.group_id === 'base')) !== canonical(basePlan.placement) ||
      canonical(immutableGroup(page.groups.find(g => g.id === 'g2'))) !== canonical(immutableGroup(plan.group)) ||
      canonical(page.placements.find(p => p.group_id === 'g2')) !== canonical(plan.placement))
    throw new Error('Closed g2 registry readback mismatch; stop without replay');
}

/** Completes only the final read-back checkpoint of an interrupted run. It
 * never calls register_group/register_group_placement; any mismatch, other
 * pending intent or unexpected revision stops without writing. */
export async function reconcileClosedG2Readback({ receipt, expectedHash, readRegistry, checkpoint }) {
  const hash = normalizeReviewedHash(expectedHash);
  if (!receipt || receipt.phase !== 'planned' || receipt.pending !== 'readback' || !receipt.plan ||
      !/^[a-f0-9]{64}$/.test(hash) || receipt.planHash !== hash || hashPlan(receipt.plan) !== hash ||
      receipt.plan.group?.accepting !== false || receipt.plan.openingAuthorized !== false)
    throw new Error('Pending readback receipt for the reviewed plan required');
  const base = BigInt(receipt.plan.expectedRevision);
  if (receipt.groupRevision !== (base + 1n).toString() || receipt.placementRevision !== (base + 2n).toString())
    throw new Error('Pending readback receipt for the reviewed plan required');
  const revision = BigInt(receipt.placementRevision);
  assertClosedG2Readback(await readRegistry(revision), receipt.plan, revision);
  await checkpoint({ ...receipt, pending: null, phase: 'registered-closed' });
  return { registeredClosed: true, reconciled: true, openingAuthorized: false, admissionAuthorized: false, revision: revision.toString() };
}

export function g2RegistrationSummary(plan) {
  return ['### PROD g2 closed registration — review only', '',
    `Reviewed-plan hash: \`${hashPlan(plan)}\``, '',
    `Registers one NEW group \`g2\` with 13 independent services plus the shared workload identity, on subnet \`${plan.primarySubnet}\`.`,
    'The group is recorded CLOSED: it accepts no clubs, opens nothing and admits nobody.',
    `Live registry revision \`${plan.registryRevision}\` is compared and swapped; the base group must still read exactly as its reviewed receipt.`,
    'No opening, admission, funding, DEV or database changes.', '',
    'Run `register-closed` with this hash and the exact confirmation, then `reconcile-readback` only if a run is interrupted.'].join('\n') + '\n';
}
