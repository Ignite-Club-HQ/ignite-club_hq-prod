import test from 'node:test';
import assert from 'node:assert/strict';
import { PROD_CHECK_IDS as ids } from './prod-connection-check-policy.mjs';
import { buildBasePlan, hashPlan } from './prod-base-group-policy.mjs';
import { buildProdG2Plan, g2PlanSummary } from './prod-g2-plan-policy.mjs';
import { runProdG2Plan } from './prod-g2-plan.mjs';
const principal = 'kydv5-mptl2-ip3ie-5zwd3-gc5en-4opnd-mytmr-gza6m-xh5t4-jz662-7ae';
const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod', IGNITE_ICP_ENV: 'prod', PROD_GOVERNOR_PRINCIPAL: principal, GITHUB_SHA: 'a'.repeat(40) };
function input() {
  const observations = Object.keys(ids).map(name => ({ name, id: ids[name], controllers: [principal], moduleHash: 'b'.repeat(64), subnet: 'reviewed-subnet' }));
  const plan = buildBasePlan({ ids, principal, sourceCommit: env.GITHUB_SHA, observations,
    page: { groups: [], placements: [], next_cursor: [], revision: 0n, configuration_revision: [0n] },
    budgets: { maxClubs: '100', minCycles: '1000000000000', heapBudgetBytes: '3221225472' } });
  return { ids, env, principal, observations, balance: '8000000000000', checkedAt: '2026-11-01T03:45:00Z',
    receipt: { phase: 'registered-closed', pending: null, planHash: hashPlan(plan), plan, placementRevision: '2' },
    page: { groups: [structuredClone(plan.group)], placements: [structuredClone(plan.placement)], next_cursor: [], revision: '2', configuration_revision: ['2'] } };
}
test('g2 needs 12 independent domains plus a photo store; shared infrastructure stays PROD-only', () => {
  const p = buildProdG2Plan(input());
  assert.equal(p.services.length, 13);
  assert.equal(new Set(p.services.map(s => s.name)).size, 13);
  assert.equal(p.services.filter(s => s.name === 'media_blob_store').length, 1);
  assert.ok(p.services.every(s => s.canisterId === null));
  assert.equal(p.sharedInfrastructure.identity_access, ids.identity_access);
});
test('default funding estimate preserves 19.5T fuel and budgets 1.3T fees, totaling 20.8T', () => {
  const f = buildProdG2Plan(input()).funding;
  assert.equal(f.initialRetainedFuelCycles, '19500000000000');
  assert.equal(f.estimatedCreationFeesCycles, '1300000000000');
  assert.equal(f.estimatedRequiredCycles, '20800000000000');
  assert.equal(f.shortfallCycles, '12800000000000');
  assert.equal(f.exactQuote, false);
});
test('balance never rounds Nat to Number, and surplus never creates negative shortfall', () => {
  const i = input(); i.balance = '9007199254740993';
  const f = buildProdG2Plan(i).funding;
  assert.equal(f.balanceCycles, '9007199254740993'); assert.equal(f.shortfallCycles, '0');
});
test('proposal never authorizes spend, creation, lifecycle release or opening', () => {
  const p = buildProdG2Plan(input());
  for (const key of ['executable', 'fundingAuthorized', 'creationAuthorized', 'openingAuthorized', 'lifecycleReleaseAuthorized']) assert.equal(p[key], false);
});
test('unresolved or altered base receipts fail closed', () => {
  for (const alter of [i => i.receipt.pending = 'readback', i => i.receipt.phase = 'planned', i => i.receipt.plan.group.max_clubs = 101]) {
    const i = input(); alter(i); assert.throws(() => buildProdG2Plan(i), /receipt/);
  }
});
test('unknown/partial groups, accepting base and changed placement cannot authorize a new g2', () => {
  for (const alter of [i => i.page.groups.push({ id: 'g2' }), i => i.page.next_cursor = ['base'],
    i => i.page.groups[0].accepting = true, i => i.page.placements[0].deployment_id = 'mainnet']) {
    const i = input(); alter(i); assert.throws(() => buildProdG2Plan(i), /registry|configuration/);
  }
});
test('health-only changes do not change the closed base configuration', () => {
  const i = input(); i.page.groups[0].cycles = '100'; i.page.groups[0].observed_at_ns = '200';
  i.page.revision = '3'; assert.equal(buildProdG2Plan(i).configurationRevision, '2');
});
test('certified inventory refuses DEV IDs, extra controllers, missing modules or extra subnets', () => {
  for (const alter of [i => i.observations[0].id = 'dev-id', i => i.observations[0].controllers.push('other'),
    i => i.observations[0].moduleHash = '', i => i.observations[0].subnet = 'another-subnet', i => i.observations.pop()]) {
    const i = input(); alter(i); assert.throws(() => buildProdG2Plan(i), /certified|Certified/);
  }
});
test('source, revision, balance and timestamps must be complete and exact', () => {
  for (const alter of [i => i.env = { ...env, GITHUB_SHA: '' }, i => i.page.configuration_revision = [],
    i => i.balance = '-1', i => i.balance = '1.5', i => i.checkedAt = 'invalid']) {
    const i = input(); alter(i); assert.throws(() => buildProdG2Plan(i));
  }
});
test('wrong branch refuses before any reader or evidence write', async () => {
  let calls = 0;
  await assert.rejects(runProdG2Plan({ ...input(), env: { ...env, GITHUB_REF: 'refs/heads/main' },
    loadReceipt: async () => calls++, save: async () => calls++ }), /prod branch/);
  assert.equal(calls, 0);
});
test('central flow reads all 18 certified services and own balance and saves only a non-executable proposal', async () => {
  const i = input(), calls = []; let saved;
  const p = await runProdG2Plan({ ...i, loadReceipt: async () => { calls.push('receipt'); return i.receipt; },
    readRegistry: async () => { calls.push('registry'); return i.page; },
    readCertified: async (name, id) => { calls.push(name); return i.observations.find(o => o.name === name && o.id === id); },
    readBalance: async owner => { assert.equal(owner, principal); calls.push('balance'); return i.balance; },
    save: async value => { saved = value; calls.push('artifact'); } });
  assert.equal(calls.length, 22); assert.equal(saved, p); assert.equal(saved.creationAuthorized, false);
  assert.ok(g2PlanSummary(p).includes('20.800T'));
});
test('failed read produces no proposal and performs no further reads', async () => {
  let saved = false, balanceRead = false;
  const i = input();
  await assert.rejects(runProdG2Plan({ ...i, loadReceipt: async () => i.receipt, readRegistry: async () => i.page,
    readCertified: async () => { throw new Error('unreadable'); }, readBalance: async () => { balanceRead = true; }, save: async () => { saved = true; } }), /unreadable/);
  assert.equal(saved, false); assert.equal(balanceRead, false);
});