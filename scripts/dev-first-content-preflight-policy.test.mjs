import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planInventory, PRIMARY_SUBNET, SCOPES, validateRequest } from './all-group-upgrade-policy.mjs';

const shared = JSON.parse(readFileSync(new URL('../deploy/mainnet/.icp/data/mappings/ic.ids.json', import.meta.url)));
const provision = JSON.parse(readFileSync(new URL('../deploy/groups/g2/provision.json', import.meta.url)));
const principal = id => ({ toText: () => id });
const hashes = Object.fromEntries(new Set(Object.values(SCOPES).flat()).values().map(name => [name, 'a'.repeat(64)]));
function fixture() {
  const group = structuredClone(provision);
  const domains = [...Object.entries(group.canisters), ['secret_workload_identity', shared.secret_workload_identity]]
    .map(([domain, id]) => ({ domain, canister: principal(id) }));
  const registry = {
    configurationRevision: 2n,
    groups: [{ id: 'g2', target_alias: 'mainnet', domains, photo_store: [principal(group.dedicatedBlobStore.canisterId)] }],
    placements: [{
      group_id: 'g2', deployment_id: 'mainnet', host: 'https://icp-api.io',
      network_kind: 'public_mainnet', primary_subnet: principal(PRIMARY_SUBNET),
      approved_subnets: [principal(PRIMARY_SUBNET)], additional_subnets_enabled: false,
      domains: domains.map(d => ({ ...d, subnet: principal(PRIMARY_SUBNET) })),
    }],
  };
  return { provisions: [group], registry };
}
test('DEV first-content admission is check-only: no upgrade or recovery accepted', () => {
  assert.deepEqual(SCOPES.dev_first_content_admission_preflight, ['identity_access', 'club_domain']);
  assert.deepEqual(validateRequest('check', 'dev_first_content_admission_preflight'), ['identity_access', 'club_domain']);
  for (const action of ['upgrade', 'recover']) {
    assert.throws(() => validateRequest(action, 'dev_first_content_admission_preflight', 'UPGRADE ALL MAINNET GROUPS', 'a'.repeat(64)), /check-only/);
  }
});
test('preflight contains exactly shared DEV Identity and existing Group 2 club, not G1 or PROD', () => {
  const f = fixture();
  const plan = planInventory(shared, f.provisions, f.registry, 'dev_first_content_admission_preflight', hashes);
  assert.deepEqual(plan.targets.map(t => [t.groupId, t.name, t.canisterId]), [
    ['shared', 'identity_access', 'mq2sj-fiaaa-aaaal-qxlqa-cai'],
    ['g2', 'club_domain', 'yfwyv-nyaaa-aaaal-qxpyq-cai'],
  ]);
  assert.equal(plan.targets.some(t => t.groupId === 'g1' || ['events_domain', 'messaging_domain', 'pii_access_control', 'notification_queue'].includes(t.name)), false);
  assert.deepEqual(plan.targets.map(t => t.newHash), ['a'.repeat(64), 'a'.repeat(64)]);
});
test('missing/replaced Group 2 club and third-group drift fail closed', () => {
  const replacement = fixture();
  replacement.provisions[0].canisters.club_domain = 'unreviewed-club-canister';
  replacement.registry.groups[0].domains.find(d => d.domain === 'club_domain').canister = principal('unreviewed-club-canister');
  replacement.registry.placements[0].domains.find(d => d.domain === 'club_domain').canister = principal('unreviewed-club-canister');
  assert.throws(() => planInventory(shared, replacement.provisions, replacement.registry, 'dev_first_content_admission_preflight', hashes), /exact shared Identity and Group 2 Club/);
  const missing = fixture();
  missing.provisions = [];
  missing.registry.groups = [];
  missing.registry.placements = [];
  assert.throws(() => planInventory(shared, missing.provisions, missing.registry, 'dev_first_content_admission_preflight', hashes));
  const extra = fixture();
  const other = structuredClone(extra.provisions[0]);
  other.groupId = 'g3';
  for (const name of Object.keys(other.canisters)) other.canisters[name] = 'g3-' + name.replaceAll('_', '') + '-cai';
  other.dedicatedBlobStore.canisterId = 'g3-media-store-cai';
  extra.provisions.push(other);
  const originalGroup = extra.registry.groups[0];
  const domains = [...Object.entries(other.canisters), ['secret_workload_identity', shared.secret_workload_identity]].map(([domain, id]) => ({ domain, canister: principal(id) }));
  extra.registry.groups.push({ ...originalGroup, id: 'g3', domains, photo_store: [principal(other.dedicatedBlobStore.canisterId)] });
  extra.registry.placements.push({ ...extra.registry.placements[0], group_id: 'g3', domains: domains.map(d => ({ ...d, subnet: principal(PRIMARY_SUBNET) })) });
  assert.throws(() => planInventory(shared, extra.provisions, extra.registry, 'dev_first_content_admission_preflight', hashes), /exact shared Identity and Group 2 Club/);
});
test('workflow only accepts check mode with exact scoped main-branch guard', () => {
  const workflow = readFileSync(new URL('../.github/workflows/upgrade-all-groups.yml', import.meta.url), 'utf8');
  assert.match(workflow, /options: \[full_backend, dev_identity_directory, dev_first_content_admission_preflight,/);
  assert.match(workflow, /inputs\.scope == 'dev_first_content_admission_preflight' \|\| inputs\.scope == 'dev_identity_directory'/);
  assert.match(workflow, /if: inputs\.scope == 'dev_first_content_admission_preflight'\n\s+run: node --test scripts\/dev-first-content-preflight-policy\.test\.mjs/);
});
