// The routing gate is read-only: it may state what a governor approval would
// bind, but never record one, never open a group and never trust an unverified
// wiring item. These fixtures are a fully wired closed PROD; each test breaks
// exactly one rule and asserts the named gap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';
import { reviewRoutingGate, groupApprovalConfiguration, sha256Hex, assertRoutingGateContext,
  expectedServices, ADMISSION_FLAG, ADMISSION_AUTHORITY, ADMISSION_DOMAINS, RECIPROCAL_LINKS, readFuelBalance } from './prod-routing-gate-policy.mjs';

const governor = PROD_CHECK_IDS.club_domain.replace(/.$/, 'x');
const worker = 'vnant-3snr2-22u5y-hpfoa-er3qu-h2z42-3qsfa-2ugcb-absre-jihnw-dqe';
const identity = PROD_CHECK_IDS.identity_access;
const routerId = PROD_CHECK_IDS.shard_router;
const gid = (group, name) => `${group}-${name}-cai`;

const domainsFor = group => [...GROUP_DOMAINS.map(d => ({ domain: d, canister: gid(group, d) })),
  { domain: 'secret_workload_identity', canister: 'shared-workload-cai' }];
const group = (id, accepting = false) => ({ id, target_alias: 'mainnet', accepting, max_clubs: 500, assigned_clubs: 3,
  min_cycles: '1000', heap_budget_bytes: '2000', heap_bytes: '10', cycles: '5000', observed_at_ns: '1',
  domains: domainsFor(id), photo_store: [gid(id, 'media_blob_store')] });
const placement = id => ({ group_id: id, deployment_id: 'prod', deployment_revision: '1', host: 'https://icp-api.io',
  network_kind: 'public_mainnet', primary_subnet: 'subnet-prod', approved_subnets: ['subnet-prod'],
  additional_subnets_enabled: false, domains: domainsFor(id).map(d => ({ ...d, subnet: 'subnet-prod' })) });

const checksAdmission = name => ADMISSION_DOMAINS.includes(name) || name === 'media_blob_store';

function service(groupName, name, overrides = {}) {
  const configuration = (RECIPROCAL_LINKS[name] ?? []).map(peer => [peer, gid(groupName, peer)]);
  if (name === 'club_domain') configuration.push(['identity_access', identity],
    ['media_store', gid(groupName, 'media_blob_store')], ['competition_authority', gid(groupName, 'competition_domain')]);
  if (name === 'competition_domain') configuration.push(['participant_club_authority', gid(groupName, 'club_domain')]);
  if (name === 'notification_queue') configuration.push(['identity_access', identity], ['worker', worker]);
  if (name === 'timer_jobs') configuration.push(['worker:*', worker]);
  const environment = checksAdmission(name)
    ? [{ name: ADMISSION_FLAG, value: '1' }, { name: ADMISSION_AUTHORITY, value: identity }] : [];
  return { group: groupName, name, id: gid(groupName, name), running: true, controllers: [governor],
    subnet: 'subnet-prod', moduleHash: 'a'.repeat(64), cycles: '9000', heapBytes: '500', environment, configuration, ...overrides };
}

const servicesFor = groupName => [...GROUP_DOMAINS.map(n => service(groupName, n)), service(groupName, 'media_blob_store')];
const identityConfig = () => [['registry', routerId], ['target_alias', 'mainnet'], ['deployment_id', 'prod'],
  ['host', 'https://icp-api.io'], ['network_kind', 'public_mainnet'], ['bound_deletion_released', 'true'],
  ['account_admission_released', 'true'],
  ...['base', 'g2'].flatMap(g => [...ADMISSION_DOMAINS.map(n => ['eligibility_authority', gid(g, n)]),
    ['eligibility_authority', gid(g, 'media_blob_store')]])];
const routerConfig = () => [['deletion_authority', identity]];

function state(overrides = {}) {
  const groups = [group('base'), group('g2')];
  const placements = [placement('base'), placement('g2')];
  const page = { groups, placements, revision: '9', configuration_revision: ['7'], next_cursor: [] };
  const approved = sha256Hex(groupApprovalConfiguration(groups, placements));
  const approval = { target_alias: 'mainnet', configuration_revision: '7', approved_configuration_sha256: approved,
    removal_wiring_group_ids: ['base', 'g2'], removal_checked_at_ms: '1762000000000', evidence_sha256: 'b'.repeat(64) };
  return { ids: PROD_CHECK_IDS, principal: governor, pushWorker: worker, page, approval,
    services: [...servicesFor('base'), ...servicesFor('g2')],
    routerConfig: routerConfig(), identityConfig: identityConfig(),
    checkedAt: '2026-11-01T20:46:30.000Z', ...overrides };
}
const review = (overrides = {}) => reviewRoutingGate(state(overrides));
const codes = r => r.gaps.map(g => g.code);
const textOf = r => r.gaps.map(g => `${g.code}: ${g.detail}`).join('\n');

test('rehearsal-wired services never constitute production removal acceptance', () => {
  const r = review();
  assert.equal(codes(r).filter(c => c === 'PRODUCTION_ADMISSION_PATH_UNRELEASED').length, 24);
  assert.equal(codes(r).filter(c => c === 'PROD_REHEARSAL_FORBIDDEN').length, 24);
  assert.equal(r.gateComplete, false);
  assert.equal(r.approvalReady, false);
  assert.equal(r.approvalDraft, null);
  assert.equal(r.openingAuthorized, false);
  assert.equal(r.admissionAuthorized, false);
  assert.equal(r.approvalRecorded, false);
});

test('a missing or stale approval is named and yields no draft', () => {
  assert.ok(codes(review({ approval: null })).includes('ROUTING_APPROVAL_MISSING'));
  assert.equal(review({ approval: null }).approvalDraft, null);
  assert.match(textOf(review({ approval: { ...state().approval, configuration_revision: '6' } })), /ROUTING_APPROVAL_STALE/);
  assert.match(textOf(review({ approval: { ...state().approval, approved_configuration_sha256: 'c'.repeat(64) } })), /ROUTING_APPROVAL_STALE/);
  assert.match(textOf(review({ approval: { ...state().approval, removal_wiring_group_ids: ['base'] } })), /ROUTING_APPROVAL_STALE/);
});

test('an open group is never approvable, however complete its wiring', () => {
  const open = state();
  open.page.groups[1].accepting = true;
  const r = reviewRoutingGate(open);
  assert.match(textOf(r), /GROUP_OPEN/);
  assert.equal(r.gateComplete, false);
  assert.equal(r.approvalDraft, null);
});

test('removal checks off, or bound to a foreign account service, blocks the gate', () => {
  const off = review({ services: [...servicesFor('base').map(s => s.name === 'vault_domain'
      ? { ...s, environment: [{ name: ADMISSION_AUTHORITY, value: identity }] } : s), ...servicesFor('g2')] });
  assert.match(textOf(off), /base\/vault_domain: account admission checks are off/);
  const foreign = review({ services: [...servicesFor('base').map(s => s.name === 'vault_domain'
      ? { ...s, environment: [{ name: ADMISSION_FLAG, value: '1' }, { name: ADMISSION_AUTHORITY, value: PROD_CHECK_IDS.club_domain }] } : s),
    ...servicesFor('g2')] });
  assert.match(textOf(foreign), /base\/vault_domain: not bound to the PROD account service/);
});

test('a non-governor controller, foreign subnet or unreadable module blocks the gate', () => {
  const broken = review({ services: [...servicesFor('base').map(s => s.name === 'events_domain'
      ? { ...s, controllers: [PROD_CHECK_IDS.club_domain], subnet: 'subnet-other', moduleHash: '' } : s), ...servicesFor('g2')] });
  const text = textOf(broken);
  assert.match(text, /CONTROLLER_NOT_GOVERNOR/);
  assert.match(text, /SUBNET_MISMATCH/);
  assert.match(text, /MODULE_HASH_MISSING/);
  assert.equal(broken.approvalDraft, null);
});

test('a reciprocal authority pointing outside its own group blocks the gate', () => {
  const leaked = review({ services: [...servicesFor('base').map(s => s.name === 'messaging_domain'
      ? { ...s, configuration: s.configuration.map(c => c[0] === 'club_domain' ? ['club_domain', PROD_CHECK_IDS.club_domain] : c) } : s),
    ...servicesFor('g2')] });
  assert.match(textOf(leaked), /base\/messaging_domain\.club_domain: not the group's own service/);
  const absent = review({ services: [...servicesFor('base').map(s => s.name === 'vault_domain'
      ? { ...s, configuration: s.configuration.filter(c => c[0] !== 'competition_domain') } : s), ...servicesFor('g2')] });
  assert.match(textOf(absent), /base\/vault_domain\.competition_domain: configuration row absent/);
});

test('delivery identity and account-admission release are separate named gates', () => {
  assert.match(textOf(review({ pushWorker: undefined })), /PUSH_WORKER_UNPINNED/);
  const noGrant = review({ services: [...servicesFor('base').map(s => s.name === 'notification_queue'
      ? { ...s, configuration: s.configuration.filter(c => c[0] !== 'worker') } : s), ...servicesFor('g2')] });
  assert.match(textOf(noGrant), /NOTIFICATION_WORKER_MISSING/);
  const held = review({ identityConfig: identityConfig().map(r => r[0] === 'account_admission_released'
    ? ['account_admission_released', 'false'] : r) });
  assert.match(textOf(held), /ADMISSION_RELEASE_UNVERIFIED/);
  assert.equal(held.approvalDraft, null);
  const unread = review({ identityConfig: identityConfig()
    .filter(r => !(r[0] === 'eligibility_authority' && r[1] === gid('base', 'vault_domain'))) });
  assert.match(textOf(unread), /ACCOUNT_ELIGIBILITY_READER_UNAUTHORIZED: base\/vault_domain/);
  assert.equal(unread.approvalDraft, null);
});

test('registry, placement and health evidence gaps are all reported, not just the first', () => {
  const truncated = state(); truncated.page.next_cursor = ['more'];
  assert.match(textOf(reviewRoutingGate(truncated)), /REGISTRY_TRUNCATED/);
  const noRouter = review({ routerConfig: [] });
  assert.match(textOf(noRouter), /ROUTER_DELETION_AUTHORITY_MISSING/);
  const starved = review({ services: [...servicesFor('base').map(s => s.name === 'club_points_domain'
      ? { ...s, cycles: '10', heapBytes: '2000', running: false } : s), ...servicesFor('g2')] });
  const text = textOf(starved);
  assert.match(text, /CYCLES_BELOW_MINIMUM/);
  assert.match(text, /HEAP_AT_BUDGET/);
  assert.match(text, /SERVICE_NOT_RUNNING/);
  assert.match(text, /base\/club_points_domain: not running/);
});

test('the approved configuration binds placement and identities, never runtime health', () => {
  const groups = [group('base'), group('g2')];
  const placements = [placement('base'), placement('g2')];
  const base = groupApprovalConfiguration(groups, placements);
  const runtime = groups.map(g => ({ ...g, assigned_clubs: 421, heap_bytes: '1', cycles: '2', observed_at_ns: '3' }));
  assert.equal(groupApprovalConfiguration(runtime, placements), base);
  const moved = groups.map(g => ({ ...g, domains: g.domains.map(d => d.domain === 'club_domain' ? { ...d, canister: 'other-cai' } : d) }));
  assert.notEqual(groupApprovalConfiguration(moved, placements), base);
});

test('group services are the twelve data services plus the group photo store', () => {
  const g = group('base'), p = placement('base');
  const list = expectedServices(g, p);
  assert.equal(list.length, GROUP_DOMAINS.length + 1);
  assert.equal(list.some(s => s.name === 'secret_workload_identity'), false);
  assert.equal(list.find(s => s.name === 'media_blob_store').id, gid('base', 'media_blob_store'));
  assert.equal(list.find(s => s.name === 'club_domain').subnet, 'subnet-prod');
});

test('context guards reject the DEV branch and an out-of-inventory target before review', () => {
  const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_REF: 'refs/heads/prod',
    IGNITE_ICP_ENV: 'prod', PROD_GOVERNOR_PRINCIPAL: governor };
  assertRoutingGateContext(PROD_CHECK_IDS, env, governor);
  assert.throws(() => assertRoutingGateContext(PROD_CHECK_IDS, { ...env, GITHUB_REF: 'refs/heads/main' }, governor), /prod branch/);
  assert.throws(() => assertRoutingGateContext(PROD_CHECK_IDS, env, '2vxsx-fae'), /mismatch/);
  assert.throws(() => assertRoutingGateContext({ ...PROD_CHECK_IDS, club_domain: 'mzzzv-taaaa-aaaal-qxlrq-cai' }, env, governor), /exact recorded/);
  assert.throws(() => assertRoutingGateContext(PROD_CHECK_IDS, { ...env, GATE_ACTION: 'record' }, governor), /read-only/);
});

test('the workflow is manual, read-only and cannot reach DEV, the database or any setter', () => {
  const w = readFileSync(new URL('../.github/workflows/check-prod-routing-gates.yml', import.meta.url), 'utf8');
  assert.match(w, /workflow_dispatch:/);
  assert.doesNotMatch(w, /schedule:|push:|contents: write|icp deploy|supabase|set_app_config|record_routing_approval|update_settings|install_code|register_group/);
  assert.match(w, /contents: read/);
  assert.match(w, /environment: production/);
  assert.match(w, /refs\/heads\/prod/);
  assert.match(w, /trap 'rm -rf "\$ICP_HOME"' EXIT/);
  assert.match(w, /@icp-sdk\/core@6\.1\.1/);
  assert.match(w, /node --test scripts\/prod-routing-gate\.test\.mjs/);
});

test('fuel diagnostics preserve exact balances, zero and shortfall without authorizing payment', () => {
  const s = state();
  s.services[0].cycles = '0';
  s.services[1].cycles = '999';
  const r = reviewRoutingGate(s);
  assert.equal(r.diagnostics[0].cycles, '0');
  assert.equal(r.diagnostics[0].shortfallCycles, '1000');
  assert.equal(r.diagnostics[1].shortfallCycles, '1');
  assert.equal(r.fuelReview.totalShortfallCycles, '1001');
  assert.equal(r.fuelReview.paymentAuthorized, false);
});

test('unreadable fuel is not low fuel and never yields an aggregate funding amount', async () => {
  assert.deepEqual(await readFuelBalance(async () => 900719925474099312345n),
    { cycles: '900719925474099312345', balanceRead: 'readback' });
  assert.deepEqual(await readFuelBalance(async () => { throw new Error('private detail'); }),
    { cycles: null, balanceRead: 'unreadable' });
  const s = state(); s.services[0].cycles = null;
  const r = reviewRoutingGate(s);
  assert.ok(codes(r).includes('CYCLES_UNREADABLE'));
  assert.ok(!codes(r).includes('CYCLES_BELOW_MINIMUM'));
  assert.equal(r.fuelReview.totalShortfallCycles, null);
});

test('setting diagnostics identify missing bindings without exporting unrelated environment values', () => {
  const s = state();
  s.services[0].environment = [{ name: 'PRIVATE_SECRET', value: 'do-not-export-this' }];
  s.services[0].configuration = s.services[0].configuration.filter(r => r[0] !== 'media_store');
  const r = reviewRoutingGate(s);
  const bindings = r.diagnostics[0].bindings;
  assert.deepEqual(bindings.find(b => b.setting === ADMISSION_AUTHORITY),
    { setting: ADMISSION_AUTHORITY, expected: identity, result: 'missing' });
  assert.equal(bindings.find(b => b.setting === 'media_store').result, 'missing');
  assert.equal(JSON.stringify(r).includes('do-not-export-this'), false);
});

test('PROD diagnostics never prescribe enabling local rehearsal to clear the gate', () => {
  const s = state();
  s.services = s.services.map(service => ({ ...service, environment: [] }));
  const r = reviewRoutingGate(s);
  const flags = r.diagnostics.flatMap(d => d.bindings).filter(b => b.setting === ADMISSION_FLAG);
  assert.equal(flags.length, 24);
  assert.ok(flags.every(b => b.expected === 'disabled in PROD' && b.result === 'matched'));
  assert.ok(codes(r).includes('PRODUCTION_ADMISSION_PATH_UNRELEASED'));
  assert.equal(r.approvalDraft, null);
});
