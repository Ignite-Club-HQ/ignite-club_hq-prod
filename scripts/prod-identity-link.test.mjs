import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROD_CHECK_IDS as ids } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';
import { buildBasePlan, hashPlan } from './prod-base-group-policy.mjs';
import { G2_SERVICES, CONFIGURATION_RECIPE } from './prod-g2-create-policy.mjs';
import { buildG2RegistrationPlan } from './prod-g2-register-policy.mjs';
import {
  assertIdentityLinkContext, buildIdentityLinkPlan, assertReviewedIdentityLinkPlan, linkAccountService,
  reconcileIdentityLinkReadback, restoreBoundDeletionRelease, mergeEnvironment, bindingMatchesRows,
  assertIdentityLinkReadback,
  IDENTITY_LINK_CONFIRMATION, IDENTITY_LINK_READBACK_CONFIRMATION, IDENTITY_LINK_RESTORE_CONFIRMATION,
  IDENTITY_LINK_RECEIPT_PATH, BOUND_DELETION_RELEASE_ENV, REHEARSAL_ENV,
} from './prod-identity-link-policy.mjs';
import { identityLinkFailureReason, saveIdentityLinkFailure } from './prod-identity-link.mjs';

const principal = 'kydv5-mptl2-ip3ie-5zwd3-gc5en-4opnd-mytmr-gza6m-xh5t4-jz662-7ae';
const subnet = 'brlsh-zidhj-3yy3e-6vqbz-7xnih-xeq2l-as5oc-g32c4-i5pdn-2wwof-oae';
const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod',
  IGNITE_ICP_ENV: 'prod', PROD_GOVERNOR_PRINCIPAL: principal, GITHUB_SHA: 'a'.repeat(40) };
const budgets = { maxClubs: '100', minCycles: '1000000000000', heapBudgetBytes: '3221225472' };

const basePlan = buildBasePlan({ ids, principal, sourceCommit: 'a'.repeat(40),
  page: { groups: [], placements: [], revision: 2n, configuration_revision: [2n], next_cursor: [] },
  observations: Object.keys(ids).map(name => ({ name, id: ids[name], moduleHash: 'b'.repeat(64),
    controllers: [principal], subnet })), budgets });
const baseReceipt = { version: 1, phase: 'registered-closed', pending: null, planHash: hashPlan(basePlan),
  plan: basePlan, groupRevision: '3', placementRevision: '4' };
const g2Canisters = Object.fromEntries(G2_SERVICES.map((name, i) =>
  [name, `x${'abcdefghijklmnopqrstuvwxyz234567'.slice(i, i + 5)}-qaaaa-aaaai-ay${i}a-cai`]));
const g2CreationPlan = { version: 1, principal, registrationAuthorized: false, openingAuthorized: false,
  lifecycleReleaseAuthorized: false, photoStoreBytes: '214748364800',
  services: G2_SERVICES.map(name => ({ name, canisterId: null, moduleHash: 'c'.repeat(64) })) };
const creationReceipt = { version: 1, phase: 'sized', pending: null, planHash: hashPlan(g2CreationPlan),
  plan: g2CreationPlan, canisters: g2Canisters, installedDomains: [...G2_SERVICES],
  configuration: { binding: 'reviewed-binding', completed: CONFIGURATION_RECIPE.map(([d, m]) => `${d}.${m}`) } };
const g2Plan = buildG2RegistrationPlan({ ids, env, principal, baseReceipt, g2Receipt: creationReceipt,
  page: { groups: [basePlan.group], placements: [basePlan.placement], revision: 4n,
    configuration_revision: [2n], next_cursor: [] },
  observations: G2_SERVICES.map(name => ({ name, id: g2Canisters[name], moduleHash: 'c'.repeat(64),
    controllers: [principal], subnet })), budgets, checkedAt: '2026-11-01T18:00:00.000Z' });
const g2Receipt = { version: 1, phase: 'registered-closed', pending: null, planHash: hashPlan(g2Plan),
  plan: g2Plan, groupRevision: '5', placementRevision: '6' };

const page = () => ({ groups: [basePlan.group, g2Plan.group],
  placements: [basePlan.placement, g2Plan.placement], revision: 6n, configuration_revision: [3n],
  next_cursor: [] });
const pinned = plan => [['registry', plan.binding.registry], ['target_alias', plan.binding.targetAlias],
  ['deployment_id', plan.binding.deploymentId], ['host', plan.binding.host],
  ['network_kind', plan.binding.networkKind], ['bound_deletion_released', 'true'],
  ['account_admission_released', 'false']];
const input = (over = {}) => ({ ids, env, principal, baseReceipt, g2Receipt, page: page(),
  routerConfig: [['deletion_authority', '']], identityConfig: null, identityEnv: [],
  checkedAt: '2026-11-01T20:00:00.000Z', ...over });
const build = (over = {}) => buildIdentityLinkPlan(input(over));

test('link context refuses DEV branches, DEV inventories and unconfirmed lifecycle writes', () => {
  assert.throws(() => assertIdentityLinkContext(ids, { ...env, GITHUB_REF: 'refs/heads/main' }, principal, 'plan'),
    /prod branch/);
  assert.throws(() => assertIdentityLinkContext({ ...ids, identity_access: 'mzzzv-taaaa-aaaal-qxlrq-cai' },
    env, principal, 'plan'), /exact recorded/);
  assertIdentityLinkContext(ids, env, principal, 'inspect');
  assertIdentityLinkContext(ids, env, principal, 'plan');
  assert.throws(() => assertIdentityLinkContext(ids, env, principal, 'link'), /confirmation/);
  assertIdentityLinkContext(ids, { ...env, CONFIRMATION: ` ${IDENTITY_LINK_CONFIRMATION} ` }, principal, 'link');
  assert.throws(() => assertIdentityLinkContext(ids, env, principal, 'open'), /Only plan/);
  assert.throws(() => assertIdentityLinkContext(ids, env, principal, 'reconcile-readback'), /confirmation/);
  assertIdentityLinkContext(ids, { ...env, CONFIRMATION: IDENTITY_LINK_READBACK_CONFIRMATION },
    principal, 'reconcile-readback');
  assert.throws(() => assertIdentityLinkContext(ids, env, principal, 'restore-release'), /confirmation/);
  assertIdentityLinkContext(ids, { ...env, CONFIRMATION: IDENTITY_LINK_RESTORE_CONFIRMATION },
    principal, 'restore-release');
});

test('the reviewed plan pins the PROD router at its live revision and authorizes nothing else', () => {
  const plan = build();
  assert.deepEqual(plan.binding, { registry: ids.shard_router, registryRevision: '6', targetAlias: 'mainnet',
    deploymentId: 'prod', deploymentRevision: '1', host: 'https://icp-api.io', networkKind: 'public_mainnet' });
  assert.equal(plan.identityAccess, ids.identity_access);
  assert.deepEqual(plan.groups, ['base', 'g2']);
  assert.equal(plan.deletionReleaseRequired, true);
  assert.equal(plan.routerAuthorityRequired, true);
  assert.equal(plan.registryPinRequired, true);
  for (const flag of ['executable', 'openingAuthorized', 'admissionAuthorized', 'groupRegistrationAuthorized',
    'routingApprovalAuthorized', 'rehearsalReleaseAuthorized']) assert.equal(plan[flag], false, flag);
});

test('an already released, bound and pinned account service plans no new effect', () => {
  const plan = build();
  const done = build({ identityEnv: [{ name: BOUND_DELETION_RELEASE_ENV, value: '1' }],
    routerConfig: [['deletion_authority', ids.identity_access]], identityConfig: pinned(plan) });
  assert.equal(done.deletionReleaseRequired, false);
  assert.equal(done.routerAuthorityRequired, false);
  assert.equal(done.registryPinRequired, false);
});

test('linking refuses an open group, a third group, a truncated registry or inventory drift', () => {
  const open = page(); open.groups[1] = { ...open.groups[1], accepting: true };
  assert.throws(() => build({ page: open }), /g2 group must stay CLOSED/);
  const third = page(); third.groups.push({ ...basePlan.group, id: 'g3' });
  third.placements.push({ ...basePlan.placement, group_id: 'g3' });
  assert.throws(() => build({ page: third }), /Exactly two registered groups/);
  assert.throws(() => build({ page: { ...page(), next_cursor: ['more'] } }), /Exactly two registered groups/);
  assert.throws(() => build({ page: { ...page(), groups: [basePlan.group, basePlan.group],
    placements: [basePlan.placement, g2Plan.placement] } }), /exactly the reviewed base and g2 groups/);
  const drift = page(); drift.groups[0] = { ...drift.groups[0], max_clubs: 500 };
  assert.throws(() => build({ page: drift }), /base group inventory differs from its reviewed receipt/);
  const moved = page(); moved.placements[1] = { ...moved.placements[1], deployment_id: 'mainnet' };
  assert.throws(() => build({ page: moved }), /g2 placement must be the reviewed public-mainnet PROD deployment/);
  const extraSubnet = page(); extraSubnet.placements[0] = { ...extraSubnet.placements[0],
    approved_subnets: [subnet, subnet] };
  assert.throws(() => build({ page: extraSubnet }), /exactly one approved subnet/);
});

test('a router or account service already wired elsewhere stops the run for review', () => {
  assert.throws(() => build({ routerConfig: [['deletion_authority',
    'wnf4o-tyaaa-aaaaa-aaaaa-cai']] }), /already bound to another principal/);
  assert.throws(() => build({ identityConfig: [['registry', 'wnf4o-tyaaa-aaaaa-aaaaa-cai'],
    ['target_alias', 'mainnet'], ['deployment_id', 'prod'], ['host', 'https://icp-api.io'],
    ['network_kind', 'public_mainnet']] }), /already pinned to a different registry/);
  assert.throws(() => build({ identityEnv: [{ name: BOUND_DELETION_RELEASE_ENV, value: '0' }] }),
    /is set to "0"; review before linking/);
  assert.throws(() => build({ identityEnv: [{ name: REHEARSAL_ENV, value: '1' }] }),
    /must stay disabled on PROD/);
  assert.throws(() => build({ baseReceipt: { ...baseReceipt, planHash: 'f'.repeat(64) } }),
    /Reviewed closed-group receipts required/);
  assert.throws(() => build({ g2Receipt: { ...g2Receipt, phase: 'planned' } }),
    /Confirmed closed base and g2 registration receipts required/);
});

test('the reviewed hash ignores the clock but still rejects live drift', () => {
  const plan = build();
  const hash = hashPlan(plan);
  const rebuilt = build({ checkedAt: '2026-11-02T09:00:00.000Z' });
  assert.notEqual(hashPlan(rebuilt), hash, 'the clock alone changes a fresh plan hash');
  assertReviewedIdentityLinkPlan(plan, hash, rebuilt);
  assert.throws(() => assertReviewedIdentityLinkPlan(plan, 'f'.repeat(64), rebuilt), /does not match the saved/);
  assert.throws(() => assertReviewedIdentityLinkPlan(plan, 'not-a-hash', rebuilt), /64 lowercase hex/);
  assert.throws(() => assertReviewedIdentityLinkPlan(plan, hash, build({ identityEnv:
    [{ name: BOUND_DELETION_RELEASE_ENV, value: '1' }] })), /re-plan before linking/);
  const movedRegistry = build({ page: { ...page(), revision: 7n } });
  assert.throws(() => assertReviewedIdentityLinkPlan(plan, hash, movedRegistry), /re-plan before linking/);
});

test('the apply journals each intent, verifies it, and never writes past a failed readback', async () => {
  const plan = build();
  const state = { env: [], authority: '', pinnedRows: null, writes: [] };
  const checkpoints = [];
  const verified = await linkAccountService({ plan,
    receipt: { version: 1, phase: 'planned', pending: null, planHash: hashPlan(plan), plan },
    checkpoint: async receipt => checkpoints.push(receipt.pending ?? receipt.phase),
    setEnvironment: async () => { state.writes.push('environment'); state.env = [{ name: BOUND_DELETION_RELEASE_ENV, value: '1' }]; },
    readEnvironment: async () => state.env,
    setDeletionAuthority: async () => { state.writes.push('authority'); state.authority = plan.identityAccess; },
    readRouterConfig: async () => [['deletion_authority', state.authority]],
    pinRegistry: async () => { state.writes.push('pin'); state.pinnedRows = pinned(plan); },
    readIdentityConfig: async () => state.pinnedRows,
    readRegistryPage: async () => page() });
  assert.deepEqual(state.writes, ['environment', 'authority', 'pin']);
  assert.deepEqual(checkpoints, ['deletion-release', 'router-authority', 'registry-pin', 'readback', 'linked']);
  assert.equal(verified.linked, true);
  assert.equal(verified.openingAuthorized, false);
  assert.equal(verified.routingApprovalAuthorized, false);
});

test('a pin that does not read back stops before the final readback and leaves the intent for review', async () => {
  const plan = build();
  const state = { env: [], authority: '', pinnedRows: null, writes: [] };
  const checkpoints = [];
  await assert.rejects(linkAccountService({ plan,
    receipt: { version: 1, phase: 'planned', pending: null, planHash: hashPlan(plan), plan },
    checkpoint: async receipt => checkpoints.push(receipt.pending ?? receipt.phase),
    setEnvironment: async () => { state.env = [{ name: BOUND_DELETION_RELEASE_ENV, value: '1' }]; },
    readEnvironment: async () => state.env,
    setDeletionAuthority: async () => { state.authority = plan.identityAccess; },
    readRouterConfig: async () => [['deletion_authority', state.authority]],
    pinRegistry: async () => { state.writes.push('pin'); },
    readIdentityConfig: async () => state.pinnedRows,
    readRegistryPage: async () => page() }), /registry pin readback failed/);
  assert.deepEqual(checkpoints, ['deletion-release', 'router-authority', 'registry-pin']);
  assert.deepEqual(state.writes, ['pin']);
});

test('an interrupted run replays nothing, and reconciliation completes only the final readback', async () => {
  const plan = build();
  const planned = { version: 1, phase: 'planned', pending: null, planHash: hashPlan(plan), plan };
  const pendingRun = { ...planned, pending: 'registry-pin' };
  const writes = [];
  const deps = () => ({ setEnvironment: async () => writes.push('environment'),
    readEnvironment: async () => [], setDeletionAuthority: async () => writes.push('authority'),
    readRouterConfig: async () => [['deletion_authority', '']], pinRegistry: async () => writes.push('pin'),
    readIdentityConfig: async () => null, readRegistryPage: async () => page() });
  await assert.rejects(linkAccountService({ plan, receipt: pendingRun, checkpoint: async () => {},
    ...deps() }), /Unresolved account-service intent/);
  assert.deepEqual(writes, []);

  const interrupted = { ...planned, pending: 'readback' };
  const checkpoints = [];
  const done = await reconcileIdentityLinkReadback({ receipt: interrupted, expectedHash: hashPlan(plan),
    readState: async p => ({ routerConfig: [['deletion_authority', p.identityAccess]],
      identityConfig: pinned(p), identityEnv: [{ name: BOUND_DELETION_RELEASE_ENV, value: '1' }],
      page: page() }), checkpoint: async receipt => checkpoints.push(receipt.phase) });
  assert.equal(done.completed, true);
  assert.deepEqual(writes, []);
  assert.deepEqual(checkpoints, ['linked']);

  await assert.rejects(reconcileIdentityLinkReadback({ receipt: pendingRun, expectedHash: hashPlan(plan),
    readState: async () => ({}), checkpoint: async () => {} }), /readback-only pass/);
  await assert.rejects(reconcileIdentityLinkReadback({ receipt: interrupted, expectedHash: 'f'.repeat(64),
    readState: async () => ({}), checkpoint: async () => {} }), /required for reconciliation/);
  const finished = { ...planned, pending: null, phase: 'linked', verified: { linked: true } };
  assert.deepEqual(await reconcileIdentityLinkReadback({ receipt: finished, expectedHash: hashPlan(plan),
    readState: async () => { throw new Error('must not read'); }, checkpoint: async () => {} }),
  { completed: true, verified: { linked: true } });
});

test('the full readback insists admission and rehearsal stay off', () => {
  const plan = build();
  const good = { routerConfig: [['deletion_authority', plan.identityAccess]], identityConfig: pinned(plan),
    identityEnv: [{ name: BOUND_DELETION_RELEASE_ENV, value: '1' }], page: page() };
  assert.equal(assertIdentityLinkReadback(good, plan).linked, true);
  assert.throws(() => assertIdentityLinkReadback({ ...good, identityConfig: pinned(plan)
    .map(([k, v]) => k === 'account_admission_released' ? [k, 'true'] : [k, v]) }, plan),
  /Account admission must remain disabled/);
  assert.throws(() => assertIdentityLinkReadback({ ...good, identityConfig: pinned(plan)
    .map(([k, v]) => k === 'bound_deletion_released' ? [k, 'false'] : [k, v]) }, plan),
  /did not read back as released/);
  assert.throws(() => assertIdentityLinkReadback({ ...good, identityEnv: [{ name: BOUND_DELETION_RELEASE_ENV,
    value: '1' }, { name: REHEARSAL_ENV, value: '1' }] }, plan), /Rehearsal must remain disabled/);
  assert.throws(() => assertIdentityLinkReadback({ ...good, page: { ...page(), revision: 7n } }, plan),
    /Registry inventory changed/);
  assert.equal(bindingMatchesRows(plan.binding, null), false);
});

test('the environment merge never drops an unrelated variable and replays as a no-op', () => {
  const current = [{ name: 'VETKD_KEY_NAME', value: 'ignite' }, { name: 'GOVERNOR_PRINCIPAL', value: principal }];
  const merged = mergeEnvironment(current, [{ name: BOUND_DELETION_RELEASE_ENV, value: '1' }]);
  assert.deepEqual(merged, [{ name: 'GOVERNOR_PRINCIPAL', value: principal },
    { name: BOUND_DELETION_RELEASE_ENV, value: '1' }, { name: 'VETKD_KEY_NAME', value: 'ignite' }]);
  assert.deepEqual(mergeEnvironment(merged, [{ name: BOUND_DELETION_RELEASE_ENV, value: '1' }]), merged);
  assert.deepEqual(mergeEnvironment(undefined, [{ name: 'A_ONE', value: 'x' }]), [{ name: 'A_ONE', value: 'x' }]);
  assert.throws(() => mergeEnvironment(current, [{ name: 'lower_case', value: '1' }]), /Invalid environment variable name/);
  assert.throws(() => mergeEnvironment(current, [{ name: 'A_ONE', value: 1 }]), /Invalid environment variable value/);
});

test('failure reporting quotes known refusals and hides everything else', () => {
  assert.equal(identityLinkFailureReason('Router deletion authority is already bound to another principal; stop and review'),
    'Router deletion authority is already bound to another principal; stop and review');
  assert.equal(identityLinkFailureReason('Exact confirmation required: LINK PROD ACCOUNT SERVICE'),
    'Exact confirmation required: LINK PROD ACCOUNT SERVICE');
  const hidden = identityLinkFailureReason(`connect ECONNREFUSED ${ids.identity_access} secret-token-abc`);
  assert.match(hidden, /stopped before completing/);
  assert.doesNotMatch(hidden, /secret-token-abc|ECONNREFUSED|tgfbl/);

  const dir = mkdtempSync(path.join(tmpdir(), 'identity-link-failure-'));
  try {
    const report = saveIdentityLinkFailure({ CHECK_REPORT_DIR: dir, LINK_ACTION: 'link',
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md') },
    new Error(`Account service refused the registry pin for ${principal}`), 'account service registry pin');
    const saved = JSON.parse(readFileSync(path.join(dir, 'prod-identity-link-failure.json'), 'utf8'));
    assert.equal(saved.stage, 'account service registry pin');
    assert.equal(saved.retryAuthorized, false);
    assert.equal(saved.reason, report.reason);
    assert.doesNotMatch(readFileSync(path.join(dir, 'summary.md'), 'utf8'), new RegExp(principal));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the link receipt lives on its own durable path and the runner stays closed-only', () => {
  assert.equal(IDENTITY_LINK_RECEIPT_PATH, 'prod-group-setup/identity-link.json');
  const source = readFileSync(new URL('./prod-identity-link.mjs', import.meta.url), 'utf8');
  assert.match(source, /pin_owner_test_deletion_registry/);
  assert.match(source, /set_deletion_authority/);
  assert.match(source, /environment_variables/);
  for (const forbidden of ['register_group', 'record_group_routing_approval', 'open_group',
    'enable_group2_admission', 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', 'pin_registry_authority'])
    assert.doesNotMatch(source, new RegExp(forbidden), `${forbidden} must never be called`);
});
