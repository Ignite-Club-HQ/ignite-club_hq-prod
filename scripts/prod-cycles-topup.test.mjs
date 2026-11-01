// Tests for the PROD cycles top-up planner and its confirmation-gated
// execution: exact arithmetic, unreadable-balance handling, hash stability,
// checkpointed idempotent deposits and workflow guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planCyclesTopup, hashTopupPlan, topupSummary, assertTopupContext, assertReviewedTopupPlan,
  planDeposits, runCyclesTopup, resumeTopupIntent, topupResultSummary,
  TOPUP_CONFIRMATION, DEPOSIT_FEE_BUDGET } from './prod-cycles-topup-policy.mjs';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';

const T = 1000000000000n;
const group = (id, min) => ({ id, target_alias: 'mainnet', accepting: false, min_cycles: String(min),
  photo_store: [`${id}-store`], domains: [{ domain: 'club_domain', canister: `${id}-club_domain` }, { domain: 'events_domain', canister: `${id}-events_domain` }] });
const placement = id => ({ group_id: id, primary_subnet: 'subnet-1', domains: [{ domain: 'club_domain', canister: `${id}-club_domain`, subnet: 'subnet-1' }, { domain: 'events_domain', canister: `${id}-events_domain`, subnet: 'subnet-1' }] });
const page = { groups: [group('base', T), group('g2', T)], placements: [placement('base'), placement('g2')], next_cursor: [] };
const svc = (g, name, cycles) => ({ group: g, name, id: `${g}-${name === 'media_blob_store' ? 'store' : name}`, cycles, balanceRead: cycles === null ? 'unreadable' : 'readback' });
const allServices = cyclesOf => [
  svc('base', 'club_domain', cyclesOf.base), svc('base', 'events_domain', cyclesOf.base), svc('base', 'media_blob_store', cyclesOf.base),
  svc('g2', 'club_domain', cyclesOf.g2), svc('g2', 'events_domain', cyclesOf.g2), svc('g2', 'media_blob_store', cyclesOf.g2),
];
const AT = '2026-11-01T22:00:00.000Z';

test('exact per-canister top-up amounts and totals', () => {
  const plan = planCyclesTopup({ page, checkedAt: AT,
    services: allServices({ base: String(T / 2n), g2: String(T - 10n) }),
    signingAccount: { balance: String(3n * T), balanceRead: 'readback' } });
  const baseClub = plan.items.find(i => i.group === 'base' && i.name === 'club_domain');
  assert.equal(baseClub.topUp, String(T / 2n));
  const g2Club = plan.items.find(i => i.group === 'g2' && i.name === 'club_domain');
  assert.equal(g2Club.topUp, '10');
  assert.equal(plan.totals.totalTopUp, String(3n * (T / 2n) + 30n));
  assert.equal(plan.totals.needingFuel, 6);
  assert.equal(plan.signingAccount.remainingAfter, String(3n * T - (3n * (T / 2n) + 30n)));
});

test('a canister already at target needs nothing', () => {
  const plan = planCyclesTopup({ page, checkedAt: AT,
    services: allServices({ base: String(T), g2: String(2n * T) }),
    signingAccount: { balance: '0', balanceRead: 'readback' } });
  assert.equal(plan.totals.totalTopUp, '0');
  assert.equal(plan.totals.needingFuel, 0);
  assert.equal(plan.signingAccount.remainingAfter, '0');
});

test('an unreadable balance is excluded from totals, never treated as zero', () => {
  const plan = planCyclesTopup({ page, checkedAt: AT,
    services: allServices({ base: null, g2: String(T) }),
    signingAccount: { balance: null, balanceRead: 'unreadable' } });
  assert.equal(plan.totals.totalTopUp, '0');
  assert.equal(plan.items.filter(i => i.balanceRead === 'unreadable').length, 3);
  assert.equal(plan.signingAccount.balance, null);
  assert.equal(plan.signingAccount.remainingAfter, null);
  assert.match(topupSummary(plan), /unreadable/);
});

test('the reserve is added to every group minimum', () => {
  const plan = planCyclesTopup({ page, checkedAt: AT, reserveCycles: String(T / 10n),
    services: allServices({ base: String(T), g2: String(T) }),
    signingAccount: { balance: '0', balanceRead: 'readback' } });
  assert.equal(plan.items[0].target, String(T + T / 10n));
  assert.equal(plan.totals.totalTopUp, String(6n * (T / 10n)));
});

test('a negative remainder is reported as a funding shortfall', () => {
  const plan = planCyclesTopup({ page, checkedAt: AT,
    services: allServices({ base: String(T / 2n), g2: String(T / 2n) }),
    signingAccount: { balance: String(T), balanceRead: 'readback' } });
  assert.equal(plan.signingAccount.remainingAfter, String(T - 3n * T));
  assert.match(topupSummary(plan), /short by/);
});

test('the plan hash is stable across observation times but binds amounts', () => {
  const input = { page, checkedAt: AT, services: allServices({ base: String(T / 2n), g2: String(T) }),
    signingAccount: { balance: String(T), balanceRead: 'readback' } };
  const a = planCyclesTopup(input);
  const b = planCyclesTopup({ ...input, checkedAt: '2026-11-02T00:00:00.000Z' });
  assert.equal(a.planHash, b.planHash);
  const c = planCyclesTopup({ ...input, services: allServices({ base: String(T / 4n), g2: String(T) }) });
  assert.notEqual(a.planHash, c.planHash);
  assert.equal(hashTopupPlan(a), a.planHash);
});

test('malformed evidence fails closed', () => {
  assert.throws(() => planCyclesTopup({ page: null, services: [], signingAccount: {}, checkedAt: AT }), /bounded consensus/);
  assert.throws(() => planCyclesTopup({ page, services: [], signingAccount: {}, checkedAt: 'not-a-date' }), /Evidence timestamp/);
  assert.throws(() => planCyclesTopup({ page, services: [], signingAccount: {}, checkedAt: AT, reserveCycles: '-5' }), /Reserve must/);
  assert.throws(() => planCyclesTopup({ page: { ...page, next_cursor: ['more'] }, services: [], signingAccount: {}, checkedAt: AT }), /bounded audit/);
  assert.throws(() => planCyclesTopup({ page: { ...page, groups: [{ ...page.groups[0], min_cycles: 'many' }, page.groups[1]] }, services: [], signingAccount: {}, checkedAt: AT }), /cycle minimum/);
});

test('the summary is honest about scope and shows exact amounts', () => {
  const plan = planCyclesTopup({ page, checkedAt: AT,
    services: allServices({ base: String(T / 2n), g2: String(T) }),
    signingAccount: { balance: String(4n * T), balanceRead: 'readback' } });
  const summary = topupSummary(plan);
  assert.match(summary, /read-only/);
  assert.match(summary, /not a payment quote/);
  assert.match(summary, /No deposit, funding order, configuration, DEV or database change/);
  assert.match(summary, /Groups stay closed/);
  assert.match(summary, new RegExp(plan.planHash));
  assert.match(summary, /base\/club_domain/);
});

test('context is pinned to the live repository prod branch and plan only', () => {
  const ids = { ...PROD_CHECK_IDS };
  const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod', IGNITE_ICP_ENV: 'prod',
    PROD_GOVERNOR_PRINCIPAL: 'kydv5-mptl2-ip3ie-5zwd3-gc5en-4opnd-mytmr-gza6m-xh5t4-jz662-7ae' };
  assert.doesNotThrow(() => assertTopupContext(ids, env, env.PROD_GOVERNOR_PRINCIPAL));
  assert.throws(() => assertTopupContext(ids, { ...env, GITHUB_REF: 'refs/heads/main' }, env.PROD_GOVERNOR_PRINCIPAL), /prod branch/);
  assert.throws(() => assertTopupContext(ids, { ...env, TOPUP_ACTION: 'apply' }, env.PROD_GOVERNOR_PRINCIPAL), /Only read-only plan/);
});

test('the workflow is a read-only prod-branch planner with no deposit or funding call', () => {
  const text = readFileSync(new URL('../.github/workflows/plan-prod-cycles-topup.yml', import.meta.url), 'utf8');
  assert.match(text, /name: "\[PROD\] Plan cycles top-up \(read-only\)"/);
  assert.match(text, /workflow_dispatch/);
  assert.match(text, /refs\/heads\/prod/);
  assert.match(text, /IGNITE_ICP_ENV:\s*prod/);
  assert.match(text, /environment: production/);
  assert.match(text, /contents: read/);
  assert.match(text, /node scripts\/prod-cycles-topup\.mjs/);
  assert.doesNotMatch(text, /deposit|create_canister|icp ledger/i);
  assert.doesNotMatch(text.replace(/--no-fund/g, ''), /fund/i);
});
