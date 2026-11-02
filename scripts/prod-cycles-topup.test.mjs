// Tests for the PROD cycles top-up planner and its confirmation-gated
// execution: exact arithmetic, unreadable-balance handling, hash stability,
// checkpointed idempotent deposits and workflow guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planCyclesTopup, hashTopupPlan, topupSummary, assertTopupContext, assertReviewedTopupPlan,
  planDeposits, runCyclesTopup, resumeTopupIntent, topupResultSummary, createTopupPlanReceipt,
  TOPUP_CONFIRMATION, DEPOSIT_FEE_BUDGET, TOPUP_RECEIPT_PATH, LANDING_TOLERANCE } from './prod-cycles-topup-policy.mjs';
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
  // contents: write is required to save the reviewed plan receipt to the
  // journal branch in the same repository; the planner makes no canister call.
  assert.match(text, /contents: write/);
  assert.match(text, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(text, /node scripts\/prod-cycles-topup\.mjs/);
  assert.doesNotMatch(text, /deposit|create_canister|icp ledger/i);
  assert.doesNotMatch(text.replace(/--no-fund/g, ''), /fund/i);
});

// ----- Confirmation-gated execution -----

const plannedInput = { page, checkedAt: AT, services: allServices({ base: String(T / 2n), g2: String(T) }),
  signingAccount: { balance: String(4n * T), balanceRead: 'readback' } };
const plannedPlan = () => planCyclesTopup(plannedInput);
const plannedReceipt = plan => ({ version: 1, phase: 'planned', pending: null, planHash: plan.planHash, plan });

test('a fresh 30B reserve plan preserves the finished receipt without reusing deposits', async () => {
  const oldPlan = plannedPlan();
  const old = { ...plannedReceipt(oldPlan), phase: 'fueled', completed: [{ amount: '500000000000' }], deposits: [{ amount: '500000000000' }] };
  const before = JSON.stringify(old);
  const plan = planCyclesTopup({ ...plannedInput, reserveCycles: '30000000000',
    services: allServices({ base: String(T), g2: String(T) }) });
  const fresh = createTopupPlanReceipt(plan, old);
  assert.equal(fresh.phase, 'planned');
  assert.equal(fresh.plan.items[0].target, '1030000000000');
  assert.equal(fresh.plan.totals.totalTopUp, '180000000000');
  assert.deepEqual(fresh.previousCompleted, old);
  assert.equal(JSON.stringify(old), before);
  assert.equal(fresh.deposits, undefined);
  assert.equal(fresh.completed, undefined);
  assert.throws(() => assertReviewedTopupPlan(fresh.plan, old.planHash, plan), /does not match/);
  const balances = new Map(plan.items.map(i => [i.id, T]));
  const amounts = [];
  await runCyclesTopup({ plan, receipt: fresh, checkpoint: async () => {}, nowNs: () => 1000000000000000000n,
    calls: { cyclesOf: async id => balances.get(id), accountBalance: async () => T,
      deposit: async ({ to, amount }) => { amounts.push(amount); balances.set(to, balances.get(to) + amount); return { blockIndex: '9' }; } } });
  assert.deepEqual(amounts, Array(6).fill(30000000000n));
  const replanned = createTopupPlanReceipt(plan, fresh);
  assert.deepEqual(replanned.previousCompleted, old);
});

test('fresh planning refuses unresolved, corrupted and exact completed receipts', () => {
  const plan = plannedPlan();
  const old = { ...plannedReceipt(plan), phase: 'fueled' };
  assert.throws(() => createTopupPlanReceipt(plan, old), /never replays/);
  for (const phase of ['topping', 'verifying', 'unknown'])
    assert.throws(() => createTopupPlanReceipt(plan, { ...old, phase }), /Unresolved intent/);
  assert.throws(() => createTopupPlanReceipt(plan, { ...old, pending: { kind: 'deposit' } }), /Unresolved intent/);
  assert.throws(() => createTopupPlanReceipt(plan, { ...old, planHash: '0'.repeat(64) }), /Reviewed top-up plan receipt required/);
});

test('topup-closed requires the exact confirmation', () => {
  const ids = { ...PROD_CHECK_IDS };
  const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod', IGNITE_ICP_ENV: 'prod',
    PROD_GOVERNOR_PRINCIPAL: 'kydv5-mptl2-ip3ie-5zwd3-gc5en-4opnd-mytmr-gza6m-xh5t4-jz662-7ae', TOPUP_ACTION: 'topup-closed' };
  assert.throws(() => assertTopupContext(ids, env, env.PROD_GOVERNOR_PRINCIPAL), new RegExp(`Exact confirmation required: ${TOPUP_CONFIRMATION}`));
  assert.throws(() => assertTopupContext(ids, { ...env, CONFIRMATION: 'yes' }, env.PROD_GOVERNOR_PRINCIPAL), /Exact confirmation required/);
  assert.doesNotThrow(() => assertTopupContext(ids, { ...env, CONFIRMATION: TOPUP_CONFIRMATION }, env.PROD_GOVERNOR_PRINCIPAL));
});

test('the reviewed hash binds the receipt and the stable plan fields', () => {
  const plan = plannedPlan();
  // Only the volatile fields differ: observation time and live account balance.
  const current = planCyclesTopup({ ...plannedInput, checkedAt: '2026-11-02T01:00:00.000Z',
    signingAccount: { balance: String(39n * T / 10n), balanceRead: 'readback' } });
  assert.doesNotThrow(() => assertReviewedTopupPlan(plan, plan.planHash, current));
  assert.throws(() => assertReviewedTopupPlan(plan, 'not-a-hash', current), /64 lowercase hex/);
  assert.throws(() => assertReviewedTopupPlan(plan, '0'.repeat(64), current), /does not match the saved top-up receipt/);
  // Balances drift down between plan and execution; the derived amounts
  // change with them and must not force a re-plan (deposits are recomputed
  // from live balances, capped at the reviewed amounts).
  const drifted = planCyclesTopup({ ...plannedInput, services: allServices({ base: String(T / 4n), g2: String(T) }) });
  assert.doesNotThrow(() => assertReviewedTopupPlan(plan, plan.planHash, drifted));
  // A different target (reserve) or inventory still forces a re-plan.
  const retargeted = planCyclesTopup({ ...plannedInput, reserveCycles: '1' });
  assert.throws(() => assertReviewedTopupPlan(plan, plan.planHash, retargeted), /inventory, targets or amounts changed; re-plan/);
  const otherPage = { ...page, groups: [group('base', 2n * T), group('g2', T)] };
  const reinventory = planCyclesTopup({ ...plannedInput, page: otherPage });
  assert.throws(() => assertReviewedTopupPlan(plan, plan.planHash, reinventory), /inventory, targets or amounts changed; re-plan/);
});

test('deposits are capped at reviewed amounts and never blind', () => {
  const plan = plannedPlan();
  const live = new Map(plan.items.filter(i => i.topUp !== '0').map(i => [`${i.group}/${i.name}`, String(BigInt(i.target) - 1n)]));
  const { deposits, totalCycles } = planDeposits({ plan, liveBalances: live, accountBalance: String(4n * T) });
  assert.equal(deposits.length, 3); // only the three base services are below target
  for (const d of deposits) assert.equal(d.amount, '1'); // drifted up since planning: only the remainder
  assert.equal(totalCycles, '3');
  const blind = new Map(live); blind.delete('base/club_domain');
  assert.throws(() => planDeposits({ plan, liveBalances: blind, accountBalance: String(4n * T) }), /Live balance unreadable for base\/club_domain/);
  assert.throws(() => planDeposits({ plan, liveBalances: live, accountBalance: '2' }), /below the reviewed top-up requirement/);
  assert.throws(() => planDeposits({ plan, liveBalances: live, accountBalance: null }), /account balance unreadable/);
  const full = new Map(plan.items.filter(i => i.topUp !== '0').map(i => [`${i.group}/${i.name}`, i.target]));
  assert.equal(planDeposits({ plan, liveBalances: full, accountBalance: '0' }).deposits.length, 0);
});

test('a checkpointed run deposits exactly the reviewed amounts and verifies landing', async () => {
  const plan = plannedPlan();
  const balances = new Map(plan.items.map(i => [i.id, BigInt(i.target) - BigInt(i.topUp)]));
  const depositsMade = [];
  const checkpoints = [];
  let now = 1_000_000_000_000_000_000n;
  const calls = {
    cyclesOf: async id => balances.get(id),
    accountBalance: async () => 4n * T,
    deposit: async ({ to, amount, createdAtNs }) => {
      depositsMade.push({ to, amount, createdAtNs });
      balances.set(to, balances.get(to) + amount);
      return { blockIndex: '42' };
    },
  };
  const result = await runCyclesTopup({ plan, receipt: plannedReceipt(plan),
    checkpoint: async r => checkpoints.push(r), calls, nowNs: () => (now += 1_000_000_000n) });
  assert.equal(result.fueled, true);
  assert.equal(result.deposited, 3);
  assert.equal(result.totalDeposited, String(3n * (T / 2n)));
  assert.deepEqual(result.stillBelowTarget, []);
  assert.equal(depositsMade.length, 3);
  for (const d of depositsMade) assert.equal(d.amount, T / 2n);
  // Every deposit was preceded by a durable acknowledged intent carrying its dedup timestamp.
  const intents = checkpoints.filter(c => c.pending?.kind === 'deposit');
  assert.equal(intents.length, 3);
  assert.ok(intents.every((c, i) => c.pending.operation === depositsMade[i].createdAtNs.toString()));
  assert.equal(checkpoints.at(-1).phase, 'fueled');
});

test('a duplicate deposit on resume is recorded, never paid twice', async () => {
  const plan = plannedPlan();
  const deposits = [{ group: 'base', name: 'club_domain', id: 'base-club_domain', amount: String(T / 2n), balanceAtBinding: String(T / 2n) }];
  const receipt = { ...plannedReceipt(plan), phase: 'topping', deposits,
    pending: { kind: 'deposit', service: 'base/club_domain', operation: '1000000000000000000', balanceBefore: String(T / 2n) } };
  let depositCalls = 0;
  const calls = {
    cyclesOf: async () => T, // the earlier, interrupted deposit already landed
    deposit: async ({ createdAtNs }) => { depositCalls += 1; assert.equal(createdAtNs, 1_000_000_000_000_000_000n); return { duplicate: true, blockIndex: '7' }; },
  };
  const next = await resumeTopupIntent({ receipt, checkpoint: async () => {}, calls, nowNs: () => 1_000_000_000_000_000_000n + 60_000_000_000n });
  assert.equal(depositCalls, 1);
  assert.equal(next.pending, null);
  assert.equal(next.completed[0].duplicate, true);
  assert.equal(next.completed[0].blockIndex, '7');
  const stale = { ...receipt, pending: { ...receipt.pending, operation: '1' } };
  await assert.rejects(() => resumeTopupIntent({ receipt: stale, checkpoint: async () => {}, calls, nowNs: () => 1_000_000_000_000_000_000n }), /dedup window; reconcile by hand/);
});

test('execution refuses a finished or unverified run and a deposit that did not land', async () => {
  const plan = plannedPlan();
  await assert.rejects(() => runCyclesTopup({ plan, receipt: { ...plannedReceipt(plan), phase: 'fueled' },
    checkpoint: async () => {}, calls: {}, nowNs: () => 0n }), /never replays a finished run/);
  await assert.rejects(() => runCyclesTopup({ plan, receipt: { ...plannedReceipt(plan), planHash: '0'.repeat(64) },
    checkpoint: async () => {}, calls: {}, nowNs: () => 0n }), /Reviewed top-up plan receipt required/);
  const balances = new Map(plan.items.map(i => [i.id, BigInt(i.target) - BigInt(i.topUp)]));
  let depositCalls = 0;
  const calls = {
    cyclesOf: async id => balances.get(id),
    accountBalance: async () => 4n * T,
    // Like the 1 Nov icrc1_transfer: the ledger accepts it, the canister's own balance never rises.
    deposit: async () => { depositCalls += 1; return { blockIndex: '1' }; },
  };
  await assert.rejects(() => runCyclesTopup({ plan, receipt: plannedReceipt(plan),
    checkpoint: async () => {}, calls, nowNs: () => 1_000_000_000_000_000_000n }), /base\/club_domain deposit did not land; stop without replay/);
  // Verified per deposit: the run stops after the FIRST canister, never sends the rest.
  assert.equal(depositCalls, 1);
});

test('normal burn between reads is tolerated, a short credit is not', async () => {
  const plan = plannedPlan();
  const make = credit => {
    const balances = new Map(plan.items.map(i => [i.id, BigInt(i.target) - BigInt(i.topUp)]));
    return { cyclesOf: async id => balances.get(id), accountBalance: async () => 4n * T,
      deposit: async ({ to, amount }) => { balances.set(to, balances.get(to) + credit(amount)); return { blockIndex: '3' }; } };
  };
  const ok = await runCyclesTopup({ plan, receipt: plannedReceipt(plan), checkpoint: async () => {},
    calls: make(a => a - LANDING_TOLERANCE / 2n), nowNs: () => 1_000_000_000_000_000_000n });
  assert.equal(ok.deposited, 3);
  await assert.rejects(() => runCyclesTopup({ plan, receipt: plannedReceipt(plan), checkpoint: async () => {},
    calls: make(a => a / 2n), nowNs: () => 1_000_000_000_000_000_000n }), /deposit did not land/);
});

test('top-ups use the ledger withdraw call, never icrc1_transfer, and a fresh receipt', () => {
  const runner = readFileSync(new URL('./prod-cycles-topup.mjs', import.meta.url), 'utf8');
  const idl = readFileSync(new URL('./prod-g2-idl.mjs', import.meta.url), 'utf8');
  assert.match(runner, /ledger\.withdraw\(\{ amount, from_subaccount: \[\], to: pid\(to\), created_at_time: \[createdAtNs\] \}\)/);
  assert.doesNotMatch(runner.replace(/\/\/.*$/gm, ''), /icrc1_transfer|ledger\.deposit/);
  const topup = idl.slice(idl.indexOf('export function topupService'), idl.indexOf('export function managementService'));
  assert.match(topup, /withdraw: IDL\.Func/);
  assert.doesNotMatch(topup, /icrc1_transfer:/);
  // The misdirected v1 receipt stays untouched as evidence.
  assert.equal(TOPUP_RECEIPT_PATH, 'prod-group-setup/cycles-topup-v2.json');
});

test('cycles held on canister-owned ledger accounts are reported, never counted as fuel', () => {
  const services = allServices({ base: String(T / 2n), g2: String(T) }).map(s => ({ ...s, ledgerHeld: s.group === 'base' ? String(T / 2n) : '0' }));
  const plan = planCyclesTopup({ ...plannedInput, services });
  assert.equal(plan.totals.totalLedgerHeld, String(3n * (T / 2n)));
  assert.equal(plan.totals.totalTopUp, String(3n * (T / 2n))); // still needs real fuel
  assert.match(topupSummary(plan), /not usable fuel/);
});

test('the result summary is honest about scope and drift', async () => {
  const plan = plannedPlan();
  const balances = new Map(plan.items.map(i => [i.id, BigInt(i.target) - BigInt(i.topUp)]));
  balances.set('base-club_domain', balances.get('base-club_domain') - 10n); // drifted down since planning
  const calls = {
    cyclesOf: async id => balances.get(id),
    accountBalance: async () => 4n * T,
    deposit: async ({ to, amount }) => { balances.set(to, balances.get(to) + amount); return { blockIndex: '9' }; },
  };
  const result = await runCyclesTopup({ plan, receipt: plannedReceipt(plan), checkpoint: async () => {}, calls, nowNs: () => 1_000_000_000_000_000_000n });
  assert.equal(result.stillBelowTarget.length, 1);
  const summary = topupResultSummary(result);
  assert.match(summary, /groups stay CLOSED/);
  assert.match(summary, /Still below the registered minimum/);
  assert.match(summary, /No registration, opening, configuration, funding order, DEV or database change/);
});

test('the execute workflow is confirmation-gated, prod-branch and deposit-only', () => {
  const text = readFileSync(new URL('../.github/workflows/execute-prod-cycles-topup.yml', import.meta.url), 'utf8');
  assert.match(text, /name: "\[PROD\] Execute cycles top-up \(closed\)"/);
  assert.match(text, /workflow_dispatch/);
  assert.match(text, /refs\/heads\/prod/);
  assert.match(text, /IGNITE_ICP_ENV:\s*prod/);
  assert.match(text, /environment: production/);
  // contents: write is required for the deposit intents and checkpoints saved
  // to the journal branch in the same repository.
  assert.match(text, /contents: write/);
  assert.match(text, /TOPUP_ACTION: topup-closed/);
  assert.match(text, /TOPUP_PLAN_HASH: \$\{\{ inputs\.plan_hash \}\}/);
  assert.match(text, /CONFIRMATION: \$\{\{ inputs\.confirmation \}\}/);
  assert.match(text, /node --test scripts\/prod-cycles-topup\.test\.mjs/);
  assert.match(text, /node scripts\/prod-cycles-topup\.mjs/);
  assert.doesNotMatch(text, /create_canister|install_code|register|accepting/i);
});
