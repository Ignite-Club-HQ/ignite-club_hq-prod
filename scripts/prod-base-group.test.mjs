import test from 'node:test';
import assert from 'node:assert/strict';
import { PROD_CHECK_IDS as ids } from './prod-connection-check-policy.mjs';
import { buildBasePlan, hashPlan, assertReviewedPlan, registerClosedBase, assertBaseContext, BASE_CONFIRMATION } from './prod-base-group-policy.mjs';
import { githubJournal, baseFailureReason, saveBaseFailure } from './prod-base-group.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const principal = 'kydv5-mptl2-ip3ie-5zwd3-gc5en-4opnd-mytmr-gza6m-xh5t4-jz662-7ae';
const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod', IGNITE_ICP_ENV: 'prod', PROD_GOVERNOR_PRINCIPAL: principal };
const input = () => ({ ids, principal, sourceCommit: 'a'.repeat(40),
  page: { groups: [], placements: [], revision: 0n, configuration_revision: [0n], next_cursor: [] },
  observations: Object.keys(ids).map(name => ({ name, id: ids[name], moduleHash: 'b'.repeat(64), controllers: [principal], subnet: 'reviewed-subnet' })),
  budgets: { maxClubs: '100', minCycles: '1000000000000', heapBudgetBytes: '3221225472' } });

test('failure diagnostics never expose arbitrary credential-bearing errors', () => {
  assert.equal(baseFailureReason(new Error('private synthetic credential')), 'Unclassified failure; inspect the saved stage and receipt without retrying registration');
  assert.equal(baseFailureReason(new Error('GitHub journal PUT failed (403); stop without replay')), 'GitHub journal PUT failed (403); stop without replay');
});
test('failure before registration still saves a safe downloadable report and summary', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'base-failure-'));
  try {
    const summary = path.join(dir, 'summary.md');
    saveBaseFailure({ CHECK_REPORT_DIR: dir, GITHUB_STEP_SUMMARY: summary }, new Error('private synthetic credential'), 'load durable receipt');
    const report = JSON.parse(readFileSync(path.join(dir, 'prod-base-failure.json'), 'utf8'));
    assert.equal(report.stage, 'load durable receipt');
    assert.equal(report.retryAuthorized, false);
    assert.equal(readFileSync(summary, 'utf8').includes('private synthetic credential'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('base uses exactly 13 domains and existing independent PROD photo store, always closed', () => {
  const p = buildBasePlan(input());
  assert.equal(p.group.domains.length, 13);
  assert.deepEqual(p.group.photo_store, [ids.media_blob_store]);
  assert.equal(p.group.accepting, false);
  assert.equal(p.placement.deployment_id, 'prod');
  assert.equal(p.lifecycleReleaseAuthorized, false);
});
test('DEV/main context and DEV inventory fail before mutations', () => {
  assert.throws(() => assertBaseContext(ids, { ...env, GITHUB_REF: 'refs/heads/main' }, principal, 'plan'), /prod branch/);
  assert.throws(() => assertBaseContext({ ...ids, club_domain: 'mzzzv-taaaa-aaaal-qxlrq-cai' }, env, principal, 'plan'), /exact recorded/);
});
test('closed registration requires exact owner confirmation', () => {
  assert.throws(() => assertBaseContext(ids, env, principal, 'register-closed'), /confirmation/);
  assertBaseContext(ids, { ...env, CONFIRMATION: ` ${BASE_CONFIRMATION} ` }, principal, 'register-closed');
  assert.throws(() => assertBaseContext(ids, env, principal, 'open'), /Only plan/);
});
test('inspection requires PROD context but no registration confirmation', () => {
  assertBaseContext(ids, env, principal, 'inspect');
  assert.throws(() => assertBaseContext(ids, { ...env, GITHUB_REF: 'refs/heads/main' }, principal, 'inspect'), /prod branch/);
});
test('read-only journal inspection never creates a missing receipt branch', async () => {
  const methods = [];
  const journal = githubJournal({ ...env, GH_TOKEN: 'synthetic-test-token' }, async (_url, options) => {
    methods.push(options.method); return { ok: false, status: 404 };
  });
  assert.equal(await journal.load({ readOnly: true }), null);
  assert.deepEqual(methods, ['GET']);
});
test('changed module invalidates reviewed plan', () => {
  const p = buildBasePlan(input()), i = input(); i.observations[0].moduleHash = 'c'.repeat(64);
  assert.throws(() => assertReviewedPlan(p, hashPlan(p), buildBasePlan(i)), /changed/);
});
test('pasted hash with surrounding line breaks is accepted, but any other change is not', () => {
  const p = buildBasePlan(input()), h = hashPlan(p);
  assert.doesNotThrow(() => assertReviewedPlan(p, `${h}\n`, buildBasePlan(input())));
  assert.doesNotThrow(() => assertReviewedPlan(p, `  ${h}\r\n`, buildBasePlan(input())));
  assert.throws(() => assertReviewedPlan(p, `${h.slice(0, 32)}\n${h.slice(32)}`, p), /64 lowercase hex/);
  assert.throws(() => assertReviewedPlan(p, h.toUpperCase(), p), /64 lowercase hex/);
  assert.throws(() => assertReviewedPlan(p, 'f'.repeat(64), p), /does not match the saved plan/);
  assert.throws(() => assertReviewedPlan(p, '', p), /64 lowercase hex/);
});
test('partial certified inventory is rejected', () => {
  const i = input(); i.observations.pop();
  assert.throws(() => buildBasePlan(i), /18-service/);
});
test('extra controller rejected', () => {
  const i = input(); i.observations[0].controllers.push('2vxsx-fae');
  assert.throws(() => buildBasePlan(i), /Certified evidence mismatch/);
});
test('subnet expansion rejected without separate approval', () => {
  const i = input(); i.observations[0].subnet = 'second-subnet';
  assert.throws(() => buildBasePlan(i), /Additional subnets/);
});
test('nonempty and truncated registries cannot be overwritten', () => {
  const i = input(); i.page.groups.push({ id: 'base' });
  assert.throws(() => buildBasePlan(i), /empty complete/);
  const j = input(); j.page.next_cursor.push('more');
  assert.throws(() => buildBasePlan(j), /empty complete/);
});
test('3 GiB maximum budget enforced concretely', () => {
  const i = input(); i.budgets.heapBudgetBytes = '3221225473';
  assert.throws(() => buildBasePlan(i), /out of bounds/);
});
const runFixture = overrides => {
  const plan = buildBasePlan(input()), calls = [], receipts = [];
  const args = { plan, receipt: { phase: 'planned', pending: null, planHash: hashPlan(plan) },
    checkpoint: async r => receipts.push(structuredClone(r)),
    registerGroup: async () => { calls.push('group'); return 1n; },
    registerPlacement: async () => { calls.push('placement'); return 2n; },
    readRegistry: async () => ({ revision: 2n, next_cursor: [], groups: [plan.group], placements: [plan.placement] }), ...overrides };
  return { args, calls, receipts };
};
test('both intents are durably recorded before calls and closed state read back', async () => {
  const f = runFixture();
  f.args.registerGroup = async () => {
    assert.equal(f.receipts.at(-1).pending, 'register_group');
    f.calls.push('group'); return 1n;
  };
  f.args.registerPlacement = async () => {
    assert.equal(f.receipts.at(-1).pending, 'register_group_placement');
    assert.equal(f.receipts.at(-1).groupRevision, '1');
    f.calls.push('placement'); return 2n;
  };
  const r = await registerClosedBase(f.args);
  assert.deepEqual(f.calls, ['group', 'placement']);
  assert.deepEqual(f.receipts.map(r => r.pending), ['register_group', 'register_group_placement', 'readback', null]);
  assert.equal(f.receipts.at(-1).phase, 'registered-closed');
  assert.equal(r.openingAuthorized, false);
});
test('journal failure prevents first external mutation', async () => {
  const f = runFixture({ checkpoint: async () => { throw new Error('write unknown'); } });
  await assert.rejects(registerClosedBase(f.args), /write unknown/);
  assert.deepEqual(f.calls, []);
});
test('unknown group call leaves intent and never proceeds to placement', async () => {
  const f = runFixture({ registerGroup: async () => { throw new Error('unknown call'); } });
  await assert.rejects(registerClosedBase(f.args), /unknown call/);
  assert.equal(f.receipts.at(-1).pending, 'register_group');
  assert.deepEqual(f.calls, []);
});
test('pending receipt is never replayed', async () => {
  const f = runFixture(); f.args.receipt.pending = 'register_group';
  await assert.rejects(registerClosedBase(f.args), /Unresolved intent/);
  assert.deepEqual(f.calls, []);
});
test('opened readback cannot complete closed registration', async () => {
  const f = runFixture(); f.args.readRegistry = async () => ({ revision: 2n, next_cursor: [], groups: [{ ...f.args.plan.group, accepting: true }], placements: [f.args.plan.placement] });
  await assert.rejects(registerClosedBase(f.args), /readback mismatch/);
  assert.equal(f.receipts.at(-1).pending, 'readback');
});
test('GitHub checkpoint verifies acknowledged commit not branch and preserves exact bytes', async () => {
  const calls = [], commit = 'd'.repeat(40); let content, sha;
  const fetcher = async (url, options) => {
    calls.push({ url, method: options.method });
    let value;
    if (url.includes('git/ref/heads')) value = { object: { sha: commit } };
    else if (options.method === 'PUT') {
      content = JSON.parse(options.body).content;
      const b = Buffer.from(content, 'base64'); sha = createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
      value = { commit: { sha: commit }, content: { sha } };
    } else if (!content) return { status: 404, ok: false };
    else value = { sha, encoding: 'base64', content };
    return { status: 200, ok: true, json: async () => value };
  };
  const journal = githubJournal({ ...env, GH_TOKEN: 'synthetic-test-token' }, fetcher);
  assert.equal(await journal.load(), null);
  await journal.save({ phase: 'planned', pending: null });
  assert.equal(calls.at(-1).url.endsWith(`?ref=${commit}`), true);
  assert.equal(calls.some(c => c.method === 'PUT'), true);
});
// Regression: decoded router replies hold Principal objects whose toJSON runs
// before a replacer; the live readback must still compare equal to the plan.
const fakePrincipal = text => ({ _isPrincipal: true, toText: () => text, toJSON: () => ({ __principal__: text }) });
const decodedPage = (plan, revision) => ({ revision: BigInt(revision), configuration_revision: [BigInt(revision)], next_cursor: [],
  groups: [{ ...plan.group, domains: plan.group.domains.map(d => ({ ...d, canister: fakePrincipal(d.canister) })),
    photo_store: plan.group.photo_store.map(fakePrincipal), min_cycles: BigInt(plan.group.min_cycles),
    heap_budget_bytes: BigInt(plan.group.heap_budget_bytes), heap_bytes: 0n, cycles: 0n, observed_at_ns: 0n }],
  placements: [{ ...plan.placement, deployment_revision: 1n, primary_subnet: fakePrincipal(plan.placement.primary_subnet),
    approved_subnets: plan.placement.approved_subnets.map(fakePrincipal),
    domains: plan.placement.domains.map(d => ({ ...d, canister: fakePrincipal(d.canister), subnet: fakePrincipal(d.subnet) })) }] });
const { reconcileClosedReadback, assertClosedReadback, READBACK_CONFIRMATION } = await import('./prod-base-group-policy.mjs');

test('decoded principals and Nat64 values read back equal to the reviewed plan', () => {
  const plan = buildBasePlan(input());
  assert.doesNotThrow(() => assertClosedReadback(decodedPage(plan, 2), plan, 2n));
  const open = decodedPage(plan, 2); open.groups[0].accepting = true;
  assert.throws(() => assertClosedReadback(open, plan, 2n), /readback mismatch/);
});
test('reconcile-readback finalizes only a pending readback and never registers', async () => {
  const plan = buildBasePlan(input()), planHash = hashPlan(plan);
  const receipt = { version: 1, phase: 'planned', pending: 'readback', planHash, plan, groupRevision: '1', placementRevision: '2' };
  const saved = [];
  const result = await reconcileClosedReadback({ receipt, expectedHash: `${planHash}\n`, readRegistry: async r => decodedPage(plan, r),
    checkpoint: async r => saved.push(r) });
  assert.equal(result.registeredClosed, true); assert.equal(result.openingAuthorized, false);
  assert.equal(saved.length, 1); assert.equal(saved[0].phase, 'registered-closed'); assert.equal(saved[0].pending, null);
});
test('reconcile-readback refuses other pending intents, wrong hash, revision or mismatch without writing', async () => {
  const plan = buildBasePlan(input()), planHash = hashPlan(plan);
  const ok = { version: 1, phase: 'planned', pending: 'readback', planHash, plan, groupRevision: '1', placementRevision: '2' };
  const saved = [];
  const run = (receipt, hash = planHash, page = r => decodedPage(plan, r)) =>
    reconcileClosedReadback({ receipt, expectedHash: hash, readRegistry: async r => page(r), checkpoint: async r => saved.push(r) });
  await assert.rejects(run({ ...ok, pending: 'register_group_placement' }), /Pending readback receipt/);
  await assert.rejects(run(ok, 'f'.repeat(64)), /Pending readback receipt/);
  await assert.rejects(run({ ...ok, placementRevision: '3' }), /Pending readback receipt/);
  await assert.rejects(run(ok, planHash, r => ({ ...decodedPage(plan, r), placements: [] })), /readback mismatch/);
  assert.equal(saved.length, 0);
});
test('reconcile-readback needs its own exact confirmation', () => {
  assert.throws(() => assertBaseContext(ids, { ...env, CONFIRMATION: BASE_CONFIRMATION }, principal, 'reconcile-readback'), /CONFIRM PROD BASE READBACK/);
  assert.doesNotThrow(() => assertBaseContext(ids, { ...env, CONFIRMATION: ` ${READBACK_CONFIRMATION}\n` }, principal, 'reconcile-readback'));
});
