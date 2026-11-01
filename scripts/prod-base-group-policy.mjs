import { createHash } from 'node:crypto';
import { PROD_CHECK_IDS, assertCheckContext, evidenceText } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';

export const BASE_CONFIRMATION = 'REGISTER PROD BASE CLOSED';
export const RECEIPTS_BRANCH = 'prod-group-setup-receipts';
export const RECEIPT_PATH = 'prod-group-setup/base.json';
export const hashPlan = plan => createHash('sha256').update(evidenceText(plan)).digest('hex');
export function assertBaseContext(ids, env, principal, action) {
  assertCheckContext(ids, env, principal);
  if (!['plan', 'register-closed'].includes(action)) throw new Error('Only plan or register-closed supported');
  if (action === 'register-closed' && env.CONFIRMATION?.trim() !== BASE_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${BASE_CONFIRMATION}`);
}
const integer = (v, name) => {
  if (!/^(0|[1-9][0-9]*)$/.test(String(v))) throw new Error(`Invalid ${name}`);
  return BigInt(v);
};
export function buildBasePlan({ ids, principal, sourceCommit, page, observations, budgets }) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? '')) throw new Error('Exact source commit required');
  if (page.next_cursor?.length || !Array.isArray(page.groups) || !Array.isArray(page.placements) ||
      page.groups.length || page.placements.length) throw new Error('Initial closed base registration requires empty complete registry');
  const revision = integer(page.revision, 'registry revision').toString();
  const configurationRevision = integer(page.configuration_revision?.[0], 'configuration revision').toString();
  const names = Object.keys(PROD_CHECK_IDS).sort();
  if (JSON.stringify(Object.keys(ids).sort()) !== JSON.stringify(names) || names.some(n => ids[n] !== PROD_CHECK_IDS[n]))
    throw new Error('Exact PROD base inventory required');
  if (!Array.isArray(observations) || observations.length !== 18 || new Set(observations.map(o => o.name)).size !== 18)
    throw new Error('Complete 18-service certified evidence required');
  const ordered = names.map(name => {
    const o = observations.find(o => o.name === name);
    if (!o || o.id !== ids[name] || !/^[a-f0-9]{64}$/.test(o.moduleHash ?? '') ||
        o.controllers?.length !== 1 || o.controllers[0] !== principal ||
        !o.subnet || ['2vxsx-fae', 'aaaaa-aa'].includes(o.subnet)) throw new Error(`Certified evidence mismatch: ${name}`);
    return { name, id: o.id, moduleHash: o.moduleHash, controllers: o.controllers, subnet: o.subnet };
  });
  const subnets = new Set(ordered.map(o => o.subnet));
  if (subnets.size !== 1) throw new Error('Additional subnets require separate approval');
  const subnet = ordered[0].subnet;
  const maxClubs = integer(budgets.maxClubs, 'max clubs');
  const minCycles = integer(budgets.minCycles, 'minimum cycles');
  const heapBudget = integer(budgets.heapBudgetBytes, 'heap budget');
  if (maxClubs < 1n || maxClubs > 100000n || minCycles < 1n || minCycles > (1n << 64n) - 1n ||
      heapBudget < 1n || heapBudget > 3221225472n) throw new Error('Router budgets out of bounds');
  const domainNames = [...GROUP_DOMAINS, 'secret_workload_identity'];
  const group = { id: 'base', target_alias: 'mainnet', accepting: false, domains: domainNames.map(domain => ({ domain, canister: ids[domain] })),
    photo_store: [ids.media_blob_store], max_clubs: Number(maxClubs), assigned_clubs: 0,
    min_cycles: minCycles.toString(), heap_budget_bytes: heapBudget.toString(), heap_bytes: '0', cycles: '0', observed_at_ns: '0' };
  const placement = { group_id: 'base', deployment_id: 'prod', deployment_revision: '1', host: 'https://icp-api.io', network_kind: 'public_mainnet',
    primary_subnet: subnet, approved_subnets: [subnet], additional_subnets_enabled: false,
    domains: group.domains.map(d => ({ ...d, subnet })) };
  return { version: 1, purpose: 'Register existing PROD base CLOSED only', sourceCommit, principal,
    expectedRevision: revision, configurationRevision, observations: ordered, group, placement,
    openingAuthorized: false, lifecycleReleaseAuthorized: false };
}
export function assertReviewedPlan(plan, expectedHash, currentPlan) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? '') || hashPlan(plan) !== expectedHash)
    throw new Error('Reviewed plan hash required');
  if (hashPlan(currentPlan) !== expectedHash) throw new Error('Live inventory, modules, controller, subnet or revision changed; re-plan');
  if (plan.group.accepting !== false || plan.openingAuthorized !== false || plan.lifecycleReleaseAuthorized !== false)
    throw new Error('Closed-only plan required');
}

/** Every checkpoint must be acknowledged and read back remotely before calls.
 * A pending intent survives runner loss and forbids replay, even if the call
 * may have succeeded. Reconciliation is read-only and separately reviewed. */
export async function registerClosedBase({ plan, receipt, checkpoint, registerGroup, registerPlacement, readRegistry }) {
  if (receipt.pending) throw new Error('Unresolved intent; reconcile without replay');
  if (receipt.phase !== 'planned' || receipt.planHash !== hashPlan(plan) || plan.group.accepting !== false)
    throw new Error('Reviewed closed plan receipt required');
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
  const page = await readRegistry(placedRevision);
  const normalize = v => JSON.parse(evidenceText(v));
  if (page.next_cursor?.length || String(page.revision) !== String(placedRevision) ||
      page.groups?.length !== 1 || page.placements?.length !== 1 ||
      evidenceText(normalize(page.groups[0])) !== evidenceText(normalize(plan.group)) ||
      evidenceText(normalize(page.placements[0])) !== evidenceText(normalize(plan.placement)))
    throw new Error('Closed registry readback mismatch; stop without replay');
  await checkpoint({ ...current, pending: null, phase: 'registered-closed' });
  return { registeredClosed: true, openingAuthorized: false, revision: placedRevision.toString() };
}