import test from 'node:test';
import assert from 'node:assert/strict';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import {
  memberAccessTargets, memberAccessEnvironment, memberAccessBinding, buildMemberAccessPlan,
  assertReviewedMemberAccessPlan, assertMemberAccessReadback,
} from './prod-member-access-policy.mjs';
import { hashPlan } from './prod-base-group-policy.mjs';
import { settingsCommitment } from './prod-protection-policy.mjs';

const HUMAN = ['club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain',
  'club_points_domain', 'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue',
  'pii_access_control'];

const group = (id, offset) => ({
  id, target_alias: 'mainnet', accepting: false, max_clubs: 100, assigned_clubs: 0,
  heap_budget_bytes: 0n, heap_bytes: 0n, min_cycles: 0n, cycles: 0n, observed_at_ns: 0n,
  domains: [...HUMAN.map((domain, index) => ({ domain, canister: `${id}-${domain}-${offset}` })),
    { domain: 'timer_jobs', canister: `${id}-timer_jobs-${offset}` },
    { domain: 'secret_workload_identity', canister: `${id}-secret-${offset}` }],
  photo_store: [`${id}-media_blob_store-${offset}`],
});

const PAGE = { groups: [group('base', 1), group('g2', 2)],
  placements: [{ group_id: 'base', deployment_id: 'prod', deployment_revision: 1n, host: 'https://icp-api.io',
    network_kind: 'public_mainnet', primary_subnet: 'subnet-base', approved_subnets: ['subnet-base'],
    additional_subnets_enabled: false },
  { group_id: 'g2', deployment_id: 'prod', deployment_revision: 1n, host: 'https://icp-api.io',
    network_kind: 'public_mainnet', primary_subnet: 'subnet-g2', approved_subnets: ['subnet-g2'],
    additional_subnets_enabled: false }],
  revision: 4n, configuration_revision: [7n], next_cursor: [] };

const LINK_RECEIPT = { phase: 'linked', pending: null, plan: { binding: {
  registry: PROD_CHECK_IDS.shard_router, registryRevision: '4', targetAlias: 'mainnet', deploymentId: 'prod',
  deploymentRevision: '1', host: 'https://icp-api.io', networkKind: 'public_mainnet' } } };

const IDENTITY_ROWS = [['registry', PROD_CHECK_IDS.shard_router], ['target_alias', 'mainnet'],
  ['deployment_id', 'prod'], ['host', 'https://icp-api.io'], ['network_kind', 'public_mainnet'],
  ['bound_deletion_released', 'true'], ['account_admission_released', 'false'],
  ['ordinary_member_access', 'false'], ['global_account_operations_deferred', 'false']];

const targets = memberAccessTargets(PROD_CHECK_IDS, PAGE);
const ENVIRONMENTS = Object.fromEntries(targets.map(target => [target.id,
  [{ name: 'IGNITE_EXISTING_SETTING', value: 'keep-me' }, { name: 'ICP_ALLOW_KEYS', value: 'yes' }]]));
const ENV = { GITHUB_SHA: 'a'.repeat(40) };

const plan = () => buildMemberAccessPlan({ ids: PROD_CHECK_IDS, env: ENV, principal: 'governor',
  page: PAGE, identityConfig: IDENTITY_ROWS, linkReceipt: LINK_RECEIPT, environments: ENVIRONMENTS,
  checkedAt: '2026-11-03T09:00:00.000Z' });

test('the plan covers exactly the twenty-four member readers and nothing else', () => {
  const built = plan();
  assert.equal(built.targets.length, 24);
  assert.equal(new Set(built.targets.map(t => t.group)).size, 2);
  assert.ok(!built.targets.some(t => t.id === PROD_CHECK_IDS.identity_access || t.id === PROD_CHECK_IDS.shard_router));
  assert.equal(built.targets.filter(t => t.changeRequired).length, 24);
});

test('the plan writes admission only and never the global removal setting', () => {
  const built = plan();
  assert.deepEqual(built.settings, [
    { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: PROD_CHECK_IDS.identity_access },
    { name: 'IGNITE_ACCOUNT_ADMISSION_RELEASE', value: '1' },
  ]);
  assert.ok(!JSON.stringify(built.settings).includes('IGNITE_ACCOUNT_REMOVAL_RELEASE'));
});

test('the plan authorizes no opening, routing, removal, erasure or recovery', () => {
  const built = plan();
  for (const flag of ['executable', 'openingAuthorized', 'routingApprovalAuthorized', 'removalReleaseAuthorized',
    'globalErasureAuthorized', 'globalRecoveryAuthorized', 'rehearsalReleaseAuthorized',
    'groupRegistrationAuthorized']) assert.equal(built[flag], false, flag);
});

test('an unrelated existing setting survives the merge untouched', () => {
  const merged = memberAccessEnvironment(ENVIRONMENTS[targets[0].id], PROD_CHECK_IDS.identity_access);
  assert.equal(merged.find(row => row.name === 'IGNITE_EXISTING_SETTING').value, 'keep-me');
  assert.equal(merged.find(row => row.name === 'ICP_ALLOW_KEYS').value, 'yes');
  assert.equal(merged.find(row => row.name === 'IGNITE_ACCOUNT_ADMISSION_RELEASE').value, '1');
  assert.ok(!merged.some(row => row.name === 'IGNITE_ACCOUNT_REMOVAL_RELEASE'));
});

test('rehearsal, released removal or a foreign authority stop the merge', () => {
  const identity = PROD_CHECK_IDS.identity_access;
  assert.throws(() => memberAccessEnvironment([{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }], identity),
    /Rehearsal forbidden/);
  assert.throws(() => memberAccessEnvironment([{ name: 'IGNITE_ACCOUNT_REMOVAL_RELEASE', value: '1' }], identity),
    /removal is already released/);
  assert.throws(() => memberAccessEnvironment([{ name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: 'someone-else' }], identity),
    /Foreign account authority/);
});

test('the reader scope must be exactly twenty-four across both closed groups', () => {
  assert.throws(() => memberAccessTargets(PROD_CHECK_IDS, { ...PAGE, groups: [PAGE.groups[0]] }),
    /Both groups must be registered and closed/);
  assert.throws(() => memberAccessTargets(PROD_CHECK_IDS, { ...PAGE,
    groups: PAGE.groups.map(g => ({ ...g, accepting: true })) }), /must be registered and closed/);
  assert.throws(() => memberAccessTargets(PROD_CHECK_IDS, { ...PAGE,
    groups: PAGE.groups.map(g => ({ ...g, domains: g.domains.filter(d => d.domain !== 'vault_domain') })) }),
    /twelve reviewed human domains/);
});

test('commissioning requires a linked receipt pinned to the current registry revision', () => {
  assert.throws(() => memberAccessBinding(null, PROD_CHECK_IDS, PAGE), /link receipt required/);
  assert.throws(() => memberAccessBinding({ ...LINK_RECEIPT, phase: 'planned' }, PROD_CHECK_IDS, PAGE),
    /link receipt required/);
  assert.throws(() => memberAccessBinding({ ...LINK_RECEIPT, pending: 'x' }, PROD_CHECK_IDS, PAGE),
    /link receipt required/);
  assert.throws(() => memberAccessBinding(LINK_RECEIPT, PROD_CHECK_IDS, { ...PAGE, revision: 5n }),
    /Registry has moved/);
  assert.equal(memberAccessBinding(LINK_RECEIPT, PROD_CHECK_IDS, PAGE).registry_revision, '4');
});

test('a plan cannot be reviewed once live settings or the registry drift', () => {
  const built = plan();
  const hash = hashPlan(built);
  assertReviewedMemberAccessPlan(built, hash, buildMemberAccessPlan({ ids: PROD_CHECK_IDS, env: ENV,
    principal: 'governor', page: PAGE, identityConfig: IDENTITY_ROWS, linkReceipt: LINK_RECEIPT,
    environments: ENVIRONMENTS, checkedAt: '2026-11-03T09:00:00.000Z' }));
  assert.throws(() => assertReviewedMemberAccessPlan(built, hash, buildMemberAccessPlan({ ids: PROD_CHECK_IDS,
    env: ENV, principal: 'governor', page: PAGE, identityConfig: IDENTITY_ROWS, linkReceipt: LINK_RECEIPT,
    environments: { ...ENVIRONMENTS, [targets[0].id]: [{ name: 'IGNITE_EXISTING_SETTING', value: 'changed' }] },
    checkedAt: '2026-11-03T09:00:00.000Z' })), /re-plan before applying/);
  assert.throws(() => assertReviewedMemberAccessPlan(built, 'b'.repeat(64), built), /plan hash does not match/);
});

test('a tampered plan that authorizes opening can never pass review', () => {
  const built = { ...plan(), openingAuthorized: true };
  assert.throws(() => assertReviewedMemberAccessPlan(built, hashPlan(built), built), /Closed-only member access/);
});

test('readback demands ordinary access commissioned with global operations still deferred', () => {
  const built = plan();
  const applied = targets.map(target => [target.id, memberAccessEnvironment(
    ENVIRONMENTS[target.id], PROD_CHECK_IDS.identity_access)]);
  const environments = Object.fromEntries(applied);
  const rows = [['registry', PROD_CHECK_IDS.shard_router], ['target_alias', 'mainnet'],
    ['deployment_id', 'prod'], ['host', 'https://icp-api.io'], ['network_kind', 'public_mainnet'],
    ['bound_deletion_released', 'true'], ['account_admission_released', 'true'],
    ['ordinary_member_access', 'true'], ['global_account_operations_deferred', 'true']];
  assert.equal(assertMemberAccessReadback({ identityConfig: rows, environments, page: PAGE }, built)
    .memberAccessEnabled, true);


  assert.throws(() => assertMemberAccessReadback({ identityConfig: rows.map(([k, v]) =>
    [k, k === 'ordinary_member_access' ? 'false' : v]), environments, page: PAGE }, built),
    /Ordinary member access did not read back/);
  assert.throws(() => assertMemberAccessReadback({ identityConfig: rows.map(([k, v]) =>
    [k, k === 'global_account_operations_deferred' ? 'false' : v]), environments, page: PAGE }, built),
    /must remain deferred/);
  assert.throws(() => assertMemberAccessReadback({ identityConfig: rows, page: PAGE,
    environments: { ...environments, [targets[0].id]: [...environments[targets[0].id],
      { name: 'IGNITE_ACCOUNT_REMOVAL_RELEASE', value: '1' }] } }, built), /must keep global removal off/);
  assert.throws(() => assertMemberAccessReadback({ identityConfig: rows, page: PAGE,
    environments: { ...environments, [targets[1].id]: environments[targets[1].id]
      .filter(row => row.name !== 'IGNITE_ACCOUNT_SERVICE_IDENTITY') } }, built),
    /not bound to the reviewed account service/);
});

test('commitments are order independent and carry no plaintext settings', () => {
  const rows = [{ name: 'B', value: '2' }, { name: 'A', value: '1' }];
  assert.equal(settingsCommitment(rows), settingsCommitment([{ name: 'A', value: '1' }, { name: 'B', value: '2' }]));
  assert.equal(settingsCommitment(rows).length, 64);
});

test('a partially applied run resumes instead of reading as drift', () => {
  const built = plan();
  const hash = hashPlan(built);
  // Simulate a crash after the first service was written: its settings now match
  // the promised after-state, the rest are untouched.
  const resumed = { ...ENVIRONMENTS, [targets[0].id]: memberAccessEnvironment(
    ENVIRONMENTS[targets[0].id], PROD_CHECK_IDS.identity_access) };
  assert.notEqual(resumed[targets[0].id], ENVIRONMENTS[targets[0].id]);
  assertReviewedMemberAccessPlan(built, hash, buildMemberAccessPlan({ ids: PROD_CHECK_IDS, env: ENV,
    principal: 'governor', page: PAGE, identityConfig: IDENTITY_ROWS, linkReceipt: LINK_RECEIPT,
    environments: resumed, checkedAt: built.checkedAt }));
  // An unrelated setting moving is still real drift and must stop the run.
  assert.throws(() => assertReviewedMemberAccessPlan(built, hash, buildMemberAccessPlan({ ids: PROD_CHECK_IDS,
    env: ENV, principal: 'governor', page: PAGE, identityConfig: IDENTITY_ROWS, linkReceipt: LINK_RECEIPT,
    environments: { ...resumed, [targets[1].id]: [{ name: 'IGNITE_EXISTING_SETTING', value: 'changed' }] },
    checkedAt: built.checkedAt })), /re-plan before applying/);
});

