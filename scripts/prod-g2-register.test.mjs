import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROD_CHECK_IDS as ids } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';
import { buildBasePlan, hashPlan } from './prod-base-group-policy.mjs';
import { G2_SERVICES, CONFIGURATION_RECIPE, G2_PHOTO_STORE_BYTES } from './prod-g2-create-policy.mjs';
import {
  assertG2RegistrationContext, buildG2RegistrationPlan, assertReviewedG2RegistrationPlan,
  registerClosedG2, assertClosedG2Readback, reconcileClosedG2Readback,
  G2_REGISTER_CONFIRMATION, G2_READBACK_CONFIRMATION,
} from './prod-g2-register-policy.mjs';
import { g2RegistrationFailureReason, saveG2RegistrationFailure } from './prod-g2-register.mjs';

const principal = 'kydv5-mptl2-ip3ie-5zwd3-gc5en-4opnd-mytmr-gza6m-xh5t4-jz662-7ae';
const subnet = 'brlsh-zidhj-3yy3e-6vqbz-7xnih-xeq2l-as5oc-g32c4-i5pdn-2wwof-oae';
const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod',
  IGNITE_ICP_ENV: 'prod', PROD_GOVERNOR_PRINCIPAL: principal, GITHUB_SHA: 'a'.repeat(40) };

const basePlan = buildBasePlan({ ids, principal, sourceCommit: 'a'.repeat(40),
  page: { groups: [], placements: [], revision: 2n, configuration_revision: [2n], next_cursor: [] },
  observations: Object.keys(ids).map(name => ({ name, id: ids[name], moduleHash: 'b'.repeat(64), controllers: [principal], subnet })),
  budgets: { maxClubs: '100', minCycles: '1000000000000', heapBudgetBytes: '3221225472' } });
const baseReceipt = { version: 1, phase: 'registered-closed', pending: null, planHash: hashPlan(basePlan), plan: basePlan,
  groupRevision: '3', placementRevision: '4' };
const g2Canisters = Object.fromEntries(G2_SERVICES.map((name, i) => [name, `x${'abcdefghijklmnopqrstuvwxyz234567'.slice(i, i + 5)}-qaaaa-aaaai-ay${i}a-cai`]));
const g2CreationPlan = { version: 1, principal, registrationAuthorized: false, openingAuthorized: false,
  lifecycleReleaseAuthorized: false, photoStoreBytes: G2_PHOTO_STORE_BYTES.toString(),
  services: G2_SERVICES.map(name => ({ name, canisterId: null, moduleHash: 'c'.repeat(64) })) };
const creationReceipt = { version: 1, phase: 'sized', pending: null, planHash: hashPlan(g2CreationPlan), plan: g2CreationPlan,
  canisters: g2Canisters, installedDomains: [...G2_SERVICES],
  configuration: { binding: 'reviewed-binding', completed: CONFIGURATION_RECIPE.map(([d, m]) => `${d}.${m}`) } };
const registryPage = () => ({ groups: [basePlan.group], placements: [basePlan.placement], revision: 4n,
  configuration_revision: [2n], next_cursor: [] });
const observations = () => G2_SERVICES.map(name => ({ name, id: g2Canisters[name], moduleHash: 'c'.repeat(64),
  controllers: [principal], subnet }));
const input = () => ({ ids, env, principal, baseReceipt, g2Receipt: creationReceipt, page: registryPage(),
  observations: observations(), budgets: { maxClubs: '100', minCycles: '1000000000000', heapBudgetBytes: '3221225472' },
  checkedAt: '2026-11-01T18:00:00.000Z' });
const build = (over = {}) => {
  const i = { ...input(), ...over };
  return { ...buildG2RegistrationPlan(i), basePlan: over.baseReceipt?.plan ?? basePlan };
};

test('registration context refuses DEV branches, DEV inventories and unconfirmed mutations', () => {
  assert.throws(() => assertG2RegistrationContext(ids, { ...env, GITHUB_REF: 'refs/heads/main' }, principal, 'plan'), /prod branch/);
  assert.throws(() => assertG2RegistrationContext({ ...ids, club_domain: 'mzzzv-taaaa-aaaal-qxlrq-cai' }, env, principal, 'plan'), /exact recorded/);
  assertG2RegistrationContext(ids, env, principal, 'inspect');
  assert.throws(() => assertG2RegistrationContext(ids, env, principal, 'register-closed'), /confirmation/);
  assertG2RegistrationContext(ids, { ...env, CONFIRMATION: ` ${G2_REGISTER_CONFIRMATION} ` }, principal, 'register-closed');
  assert.throws(() => assertG2RegistrationContext(ids, env, principal, 'open'), /Only plan/);
});

test('the reviewed plan registers one new closed g2 with 13 independent services plus the shared identity', () => {
  const p = build();
  assert.equal(p.group.id, 'g2');
  assert.equal(p.group.accepting, false);
  assert.equal(p.group.domains.length, 13);
  assert.deepEqual(p.group.photo_store, [g2Canisters.media_blob_store]);
  assert.equal(p.group.domains.find(d => d.domain === 'secret_workload_identity').canister, ids.secret_workload_identity);
  assert.equal(p.group.domains.filter(d => Object.values(ids).includes(d.canister)).length, 1,
    'only the shared workload identity may be an existing PROD canister');
  assert.deepEqual(p.placement, { group_id: 'g2', deployment_id: 'prod', deployment_revision: '1', host: 'https://icp-api.io',
    network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet], additional_subnets_enabled: false,
    domains: p.group.domains.map(d => ({ ...d, subnet })) });
  assert.equal(p.openingAuthorized, false);
  assert.equal(p.admissionAuthorized, false);
  assert.equal(p.lifecycleReleaseAuthorized, false);
});

test('a created g2 may not reuse any base canister, and every service must be certified independently', () => {
  const shared = { ...creationReceipt, canisters: { ...g2Canisters, club_domain: ids.club_domain } };
  assert.throws(() => build({ g2Receipt: { ...shared, planHash: hashPlan(shared.plan) } }), /must not reuse an existing PROD base canister/);
  const vaulted = { ...creationReceipt, canisters: { ...g2Canisters, vault_domain: ids.media_blob_store } };
  assert.throws(() => build({ g2Receipt: { ...vaulted, planHash: hashPlan(vaulted.plan) } }), /must not reuse an existing PROD base canister/);
  assert.throws(() => build({ g2Receipt: { ...creationReceipt, installedDomains: G2_SERVICES.slice(0, 12) } }), /reviewed module/);
  assert.throws(() => build({ g2Receipt: { ...creationReceipt, configuration: { binding: 'reviewed-binding',
    completed: CONFIGURATION_RECIPE.slice(0, 39).map(([d, m]) => `${d}.${m}`) } } }), /wiring operation/);
});

test('registration requires a base-only registry whose live base still equals the reviewed receipt', () => {
  const withG2 = registryPage();
  withG2.groups.push({ ...basePlan.group, id: 'g2', photo_store: [g2Canisters.media_blob_store] });
  withG2.placements.push({ ...basePlan.placement, group_id: 'g2' });
  assert.throws(() => build({ page: withG2 }), /base-only registry/);
  assert.throws(() => build({ page: { ...registryPage(), next_cursor: ['more'] } }), /base-only registry/);
  assert.throws(() => build({ baseReceipt: { ...baseReceipt, planHash: 'f'.repeat(64) } }), /closed base receipt/);
  assert.throws(() => build({ page: { ...registryPage(), groups: [{ ...basePlan.group, max_clubs: 500 }] } }), /differs from reviewed receipt/);
  assert.throws(() => build({ page: { ...registryPage(), revision: 3n } }), /predates confirmed base/);
});

test('every g2 service must run the reviewed module, under one governor, on the approved subnet', () => {
  const wrongModule = observations(); wrongModule[0].moduleHash = 'd'.repeat(64);
  assert.throws(() => build({ observations: wrongModule }), /Certified g2 evidence mismatch: club_domain/);
  const extraController = observations(); extraController[1].controllers.push('2vxsx-fae');
  assert.throws(() => build({ observations: extraController }), /Certified g2 evidence mismatch: competition_domain/);
  const wrongSubnet = observations(); wrongSubnet[2].subnet = '2vxsx-fae';
  assert.throws(() => build({ observations: wrongSubnet }), /Certified g2 evidence mismatch: events_domain/);
  assert.throws(() => build({ observations: observations().slice(0, 12) }), /Complete certified g2 evidence/);
});

test('the reviewed hash survives a later run of identical code but not any real change', () => {
  const p = build();
  const h = hashPlan(p);
  assert.doesNotThrow(() => assertReviewedG2RegistrationPlan(p, h, build()), 'a later timestamp alone must not invalidate the plan');
  assert.doesNotThrow(() => assertReviewedG2RegistrationPlan(p, `${h}\n`, build()));
  assert.throws(() => assertReviewedG2RegistrationPlan(p, 'f'.repeat(64), build()), /does not match the saved g2 registration receipt/);
  assert.throws(() => assertReviewedG2RegistrationPlan(p, '', build()), /64 lowercase hex/);
  assert.throws(() => assertReviewedG2RegistrationPlan(p, h, build({ page: { ...registryPage(), revision: 9n } })), /re-plan/);
  const drifted = observations(); drifted[3].moduleHash = 'e'.repeat(64);
  assert.throws(() => assertReviewedG2RegistrationPlan(p, h, build({ observations: drifted })), /re-plan/);
});

test('closed registration compares and swaps the exact reviewed revision, then reads both groups back', async () => {
  const p = build();
  const receipt = { version: 1, phase: 'planned', pending: null, planHash: hashPlan(p), plan: p };
  const calls = [];
  const saved = [];
  const readback = { groups: [basePlan.group, p.group], placements: [basePlan.placement, p.placement],
    revision: 6n, configuration_revision: [2n], next_cursor: [] };
  const result = await registerClosedG2({ plan: p, receipt,
    checkpoint: async r => saved.push({ phase: r.phase, pending: r.pending, groupRevision: r.groupRevision, placementRevision: r.placementRevision }),
    registerGroup: async (g, r) => { calls.push(['group', g.id, r.toString()]); return 5n; },
    registerPlacement: async (pl, r) => { calls.push(['placement', pl.group_id, r.toString()]); return 6n; },
    readRegistry: async revision => { calls.push(['read', revision.toString()]); return readback; } });
  assert.deepEqual(calls, [['group', 'g2', '4'], ['placement', 'g2', '5'], ['read', '6']]);
  assert.equal(result.registeredClosed, true);
  assert.equal(result.openingAuthorized, false);
  assert.equal(result.revision, '6');
  assert.equal(saved[0].pending, 'register_group');
  assert.equal(saved.at(-1).pending, null);
  assert.equal(saved.at(-1).phase, 'registered-closed');
});

test('an unexpected revision stops without replay and never marks the group registered', async () => {
  const p = build();
  const receipt = { version: 1, phase: 'planned', pending: null, planHash: hashPlan(p), plan: p };
  await assert.rejects(() => registerClosedG2({ plan: p, receipt, checkpoint: async () => {},
    registerGroup: async () => 77n, registerPlacement: async () => 78n, readRegistry: async () => ({}) }),
    /Unexpected registration revision; stop without replay/);
  await assert.rejects(() => registerClosedG2({ plan: p, receipt: { ...receipt, pending: 'register_group' },
    checkpoint: async () => {}, registerGroup: async () => 5n, registerPlacement: async () => 6n, readRegistry: async () => ({}) }),
    /Unresolved intent/);
});

test('read-back must show exactly two closed groups matching both reviewed plans', () => {
  const p = build();
  const good = { groups: [basePlan.group, p.group], placements: [basePlan.placement, p.placement],
    revision: 6n, configuration_revision: [2n], next_cursor: [] };
  assert.doesNotThrow(() => assertClosedG2Readback(good, p, 6n));
  assert.throws(() => assertClosedG2Readback({ ...good, groups: [basePlan.group, { ...p.group, accepting: true }] }, p, 6n), /readback mismatch/);
  assert.throws(() => assertClosedG2Readback({ ...good, groups: [basePlan.group, { ...p.group, max_clubs: 5000 }] }, p, 6n), /readback mismatch/);
  assert.throws(() => assertClosedG2Readback({ ...good, groups: [basePlan.group] }, p, 6n), /readback mismatch/);
  assert.throws(() => assertClosedG2Readback({ ...good, revision: 7n }, p, 6n), /readback mismatch/);
  assert.throws(() => assertClosedG2Readback(good, p, 5n), /readback mismatch/);
});

test('reconciliation completes only an acknowledged read-back and never re-registers', async () => {
  const p = build();
  const interrupted = { version: 1, phase: 'planned', pending: 'readback', planHash: hashPlan(p), plan: p,
    groupRevision: '5', placementRevision: '6' };
  const readback = { groups: [basePlan.group, p.group], placements: [basePlan.placement, p.placement],
    revision: 6n, configuration_revision: [2n], next_cursor: [] };
  const saved = [];
  const result = await reconcileClosedG2Readback({ receipt: interrupted, expectedHash: hashPlan(p),
    readRegistry: async () => readback, checkpoint: async r => saved.push(r) });
  assert.equal(result.reconciled, true);
  assert.equal(result.registeredClosed, true);
  assert.equal(result.revision, '6');
  assert.equal(saved[0].phase, 'registered-closed');
  await assert.rejects(() => reconcileClosedG2Readback({ receipt: { ...interrupted, pending: 'register_group' },
    expectedHash: hashPlan(p), readRegistry: async () => readback, checkpoint: async () => {} }), /Pending readback receipt/);
  await assert.rejects(() => reconcileClosedG2Readback({ receipt: interrupted, expectedHash: hashPlan(p),
    readRegistry: async () => ({ ...readback, groups: [basePlan.group] }), checkpoint: async () => {} }), /readback mismatch/);
});

test('failure diagnostics never expose arbitrary credential-bearing errors', () => {
  assert.equal(g2RegistrationFailureReason(new Error('private synthetic credential')),
    'Unclassified failure; inspect the saved stage and receipt without retrying registration');
  assert.equal(g2RegistrationFailureReason(new Error('Certified g2 evidence mismatch: vault_domain')),
    'Certified g2 evidence mismatch: vault_domain');
  assert.equal(g2RegistrationFailureReason(new Error('GitHub journal PUT failed (403); stop without replay')),
    'GitHub journal PUT failed (403); stop without replay');
});

test('failure before registration still saves a safe downloadable report and summary', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'g2-register-failure-'));
  try {
    const summary = path.join(dir, 'summary.md');
    saveG2RegistrationFailure({ CHECK_REPORT_DIR: dir, GITHUB_STEP_SUMMARY: summary },
      new Error('private synthetic credential'), 'verify reviewed plan against current source and infrastructure');
    const report = JSON.parse(readFileSync(path.join(dir, 'prod-g2-registration-failure.json'), 'utf8'));
    assert.equal(report.stage, 'verify reviewed plan against current source and infrastructure');
    assert.equal(report.retryAuthorized, false);
    assert.equal(readFileSync(summary, 'utf8').includes('private synthetic credential'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the shared workload identity is the only canister a group may reuse', () => {
  const p = build();
  assert.equal(GROUP_DOMAINS.length, 12);
  assert.ok(G2_SERVICES.includes('media_blob_store'));
  assert.ok(p.group.domains.some(d => d.domain === 'secret_workload_identity' && d.canister === ids.secret_workload_identity));
});
