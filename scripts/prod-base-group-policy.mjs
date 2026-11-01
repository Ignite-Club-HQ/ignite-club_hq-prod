import { createHash } from 'node:crypto';
import { PROD_CHECK_IDS, assertCheckContext, evidenceText } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';

export const BASE_CONFIRMATION = 'REGISTER PROD BASE CLOSED';
export const READBACK_CONFIRMATION = 'CONFIRM PROD BASE READBACK';
export const RECEIPTS_BRANCH = 'prod-group-setup-receipts';
export const RECEIPT_PATH = 'prod-group-setup/base.json';
export const canonical = value => {
  const plain = JSON.parse(evidenceText(value));
  const ordered = v => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
  return JSON.stringify(ordered(plain));
};
export const hashPlan = plan => createHash('sha256').update(canonical(plan)).digest('hex');
export function assertBaseContext(ids, env, principal, action) {
  assertCheckContext(ids, env, principal);
  if (!['plan', 'inspect', 'register-closed', 'reconcile-readback'].includes(action))
    throw new Error('Only plan, inspect, register-closed or reconcile-readback supported');
  if (action === 'register-closed' && env.CONFIRMATION?.trim() !== BASE_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${BASE_CONFIRMATION}`);
  if (action === 'reconcile-readback' && env.CONFIRMATION?.trim() !== READBACK_CONFIRMATION)
    throw new Error(`Exact confirmation required: ${READBACK_CONFIRMATION}`);
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
/** Only surrounding whitespace is trimmed (mobile paste adds line breaks);
 * the hash itself must still be exactly 64 lowercase hex characters. */
export function normalizeReviewedHash(value) {
  return String(value ?? '').trim();
}
export function assertReviewedPlan(plan, rawExpectedHash, currentPlan) {
  const expectedHash = normalizeReviewedHash(rawExpectedHash);
  if (!/^[a-f0-9]{64}$/.test(expectedHash))
    throw new Error('Reviewed plan hash required (64 lowercase hex characters)');
  if (hashPlan(plan) !== expectedHash)
    throw new Error('Reviewed plan hash does not match the saved plan receipt');
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
  assertClosedReadback(await readRegistry(placedRevision), plan, placedRevision);
  await checkpoint({ ...current, pending: null, phase: 'registered-closed' });
  return { registeredClosed: true, openingAuthorized: false, revision: placedRevision.toString() };
}
export function assertClosedReadback(page, plan, revision) {
  if (page.next_cursor?.length || String(page.revision) !== String(revision) ||
      page.groups?.length !== 1 || page.placements?.length !== 1 ||
      page.groups[0].accepting !== false ||
      canonical(page.groups[0]) !== canonical(plan.group) ||
      canonical(page.placements[0]) !== canonical(plan.placement))
    throw new Error('Closed registry readback mismatch; stop without replay');
}
/** Completes only the final read-back checkpoint of an interrupted run. It
 * never calls register_group/register_group_placement; any mismatch, other
 * pending intent or unexpected revision stops without writing. */
export async function reconcileClosedReadback({ receipt, expectedHash, readRegistry, checkpoint }) {
  const hash = normalizeReviewedHash(expectedHash);
  if (!receipt || receipt.phase !== 'planned' || receipt.pending !== 'readback' || !receipt.plan ||
      !/^[a-f0-9]{64}$/.test(hash) || receipt.planHash !== hash || hashPlan(receipt.plan) !== hash ||
      receipt.plan.group?.accepting !== false || receipt.plan.openingAuthorized !== false)
    throw new Error('Pending readback receipt for the reviewed plan required');
  const base = BigInt(receipt.plan.expectedRevision);
  if (receipt.groupRevision !== (base + 1n).toString() || receipt.placementRevision !== (base + 2n).toString())
    throw new Error('Pending readback receipt for the reviewed plan required');
  const revision = BigInt(receipt.placementRevision);
  assertClosedReadback(await readRegistry(revision), receipt.plan, revision);
  await checkpoint({ ...receipt, pending: null, phase: 'registered-closed' });
  return { registeredClosed: true, reconciled: true, openingAuthorized: false, revision: revision.toString() };
}