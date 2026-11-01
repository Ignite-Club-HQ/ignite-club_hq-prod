import test from 'node:test';
import assert from 'node:assert/strict';
import { assessGroupReadiness, GROUP_DOMAINS, setupProposal } from './prod-group-readiness.mjs';
import { PROD_CHECK_IDS as ids } from './prod-connection-check-policy.mjs';

function fixture() {
  const base = { ...Object.fromEntries(GROUP_DOMAINS.map(n => [n, ids[n]])), secret_workload_identity: ids.secret_workload_identity };
  // Distinct synthetic identifiers test equality/independence, not live acceptance.
  const extra = Object.fromEntries(GROUP_DOMAINS.map((n, i) => [n, `reviewed-prod-g2-${i}`]));
  extra.secret_workload_identity = ids.secret_workload_identity;
  const group = (id, domains, photo) => ({ id, target_alias: 'mainnet', accepting: false,
    domains: Object.entries(domains).map(([domain, canister]) => ({ domain, canister })), photo_store: [photo] });
  const groups = [group('base', base, ids.media_blob_store), group('g2', extra, 'reviewed-prod-g2-photo')];
  const placements = groups.map(g => ({ group_id: g.id, deployment_id: 'prod', deployment_revision: 1n,
    host: 'https://icp-api.io', network_kind: 'public_mainnet', primary_subnet: 'reviewed-subnet',
    approved_subnets: ['reviewed-subnet'], additional_subnets_enabled: false,
    domains: g.domains.map(d => ({ ...d, subnet: 'reviewed-subnet' })) }));
  const page = { groups, placements, revision: 8n, configuration_revision: [6n], next_cursor: [] };
  const approval = { target_alias: 'mainnet', configuration_revision: 6n, removal_checked_at_ms: 1n,
    removal_wiring_group_ids: ['base', 'g2'], evidence_sha256: 'a'.repeat(64), approved_configuration_sha256: 'b'.repeat(64) };
  const report = { connectionsComplete: true, rows: [
    { name: 'identity_access', configuration: [['registry', ids.shard_router], ['deployment_id', 'prod'],
      ['target_alias', 'mainnet'], ['host', 'https://icp-api.io'], ['network_kind', 'public_mainnet'], ['bound_deletion_released', 'true']] },
    { name: 'shard_router', method: 'read_group_opening_configuration', configuration: [['deletion_authority', ids.identity_access]] },
    { method: 'read_group_registry_page', registry: { Ok: page } },
    { method: 'read_routing_approval', approval: { Ok: [approval] } },
  ] };
  return { report, page, approval, reviewed: { g2: { domains: extra, photoStore: 'reviewed-prod-g2-photo' } } };
}
const codes = (f) => assessGroupReadiness(f.report, f.reviewed).gaps.map(g => g.code);

test('complete independent base and g2 bounded evidence never authorizes opening', () => {
  const f = fixture(), r = assessGroupReadiness(f.report, f.reviewed);
  assert.deepEqual(r.gaps, []);
  assert.equal(r.infrastructureComplete, true);
  assert.equal(r.openingAuthorized, false);
  assert.equal(r.configurationRevision, '6');
  assert.equal(setupProposal(r).executable, false);
});
test('all connections passing with no groups is incomplete', () => {
  const f = fixture(); f.page.groups = []; f.page.placements = [];
  assert.ok(codes(f).includes('NO_GROUPS_REGISTERED'));
  assert.ok(codes(f).includes('PROD_G2_MISSING'));
});
test('missing identity registry pin is incomplete', () => {
  const f = fixture(); f.report.rows[0].configuration = [];
  assert.ok(codes(f).includes('IDENTITY_REGISTRY_NOT_BOUND'));
});
test('missing approval cannot complete setup', () => {
  const f = fixture(); f.report.rows.at(-1).approval.Ok = [];
  assert.ok(codes(f).includes('ROUTING_APPROVAL_MISSING'));
});
test('health registry revision differs without invalidating configuration-bound approval', () => {
  const f = fixture(); f.page.revision = 99n;
  assert.deepEqual(codes(f), []);
});
test('stale configuration approval fails closed', () => {
  const f = fixture(); f.approval.configuration_revision = 5n;
  assert.ok(codes(f).includes('ROUTING_APPROVAL_STALE'));
});
test('partial group rejects missing service', () => {
  const f = fixture(); f.page.groups[1].domains.pop();
  assert.ok(codes(f).includes('PARTIAL_GROUP'));
});
test('DEV canister replacing reviewed PROD base fails exact inventory', () => {
  const f = fixture(); f.page.groups[0].domains.find(d => d.domain === 'events_domain').canister = 'mr3hf-7yaaa-aaaal-qxlra-cai';
  assert.ok(codes(f).includes('GROUP_ID_MISMATCH'));
});
test('extra groups require independently reviewed PROD identities', () => {
  const f = fixture(); f.reviewed = {};
  assert.ok(codes(f).includes('UNREVIEWED_GROUP_INVENTORY'));
});
test('cross-group shared photo store is rejected', () => {
  const f = fixture(); f.page.groups[1].photo_store = [ids.media_blob_store];
  assert.ok(codes(f).includes('SHARED_DATA_CANISTER'));
});
test('DEV deployment placement is rejected', () => {
  const f = fixture(); f.page.placements[1].deployment_id = 'mainnet';
  assert.ok(codes(f).includes('PLACEMENT_INCOMPLETE'));
});
test('truncated registry is never whole-inventory evidence', () => {
  const f = fixture(); f.page.next_cursor = ['more'];
  assert.ok(codes(f).includes('REGISTRY_TRUNCATED'));
});
test('missing configuration revision cannot match approval', () => {
  const f = fixture(); f.page.configuration_revision = [];
  assert.ok(codes(f).includes('CONFIGURATION_REVISION_MISSING'));
});
test('proposal never silently approves payment, lifecycle settings or opening', () => {
  const p = setupProposal(assessGroupReadiness(fixture().report));
  assert.equal(p.executable, false);
  assert.equal(p.openingAuthorized, false);
  assert.equal(p.sequence.filter(s => s.mutation).every(s => s.approvalRequired), true);
  assert.ok(p.forbidden.includes('Rehearsal flags'));
});