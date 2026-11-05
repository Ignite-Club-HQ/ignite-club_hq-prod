import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { planProdReleaseTargets, assertIdentitySourceSupportsPins, retainProdIdentity, assertRetainedIdentityReceiverCompatibility } from './prod-release-targets.mjs';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { UPGRADE_ORDER } from './icp-environments.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';
import { hashPlan } from './prod-base-group-policy.mjs';

function fixture() {
  const ids = { ...PROD_CHECK_IDS };
  const second = Object.fromEntries(GROUP_DOMAINS.map((name, i) => [name, `independent-${i}-cai`]));
  second.secret_workload_identity = ids.secret_workload_identity;
  const groups = ['base', 'g2'].map(id => ({ id, accepting: false, target_alias: 'mainnet', domains: [...GROUP_DOMAINS, 'secret_workload_identity'].map(domain => ({ domain, canister: id === 'base' ? ids[domain] : second[domain] })), photo_store: [id === 'base' ? ids.media_blob_store : 'independent-photo-cai'] }));
  const placements = groups.map(g => ({ group_id: g.id, deployment_id: 'prod', host: 'https://icp-api.io', network_kind: 'public_mainnet', additional_subnets_enabled: false, approved_subnets: ['subnet-cai'], primary_subnet: 'subnet-cai', domains: g.domains.map(d => ({ ...d, subnet: 'subnet-cai' })) }));
  const plan = { groupId: 'g2', group: groups[1], openingAuthorized: false, admissionAuthorized: false };
  return { ids, g2Receipt: { phase: 'registered-closed', pending: null, plan, planHash: hashPlan(plan) }, page: { groups, placements, configuration_revision: [7n], next_cursor: [] }, hashes: Object.fromEntries(UPGRADE_ORDER.map(n => [n, 'a'.repeat(64)])) };
}
test('18 service types cover 31 independent production targets with each shared service once', () => {
  const plan = planProdReleaseTargets(fixture());
  assert.equal(plan.targets.length, 31);
  assert.equal(plan.targets.filter(t => t.name === 'identity_access').length, 1);
  assert.equal(plan.targets.filter(t => t.name === 'club_domain').length, 2);
  assert.equal(plan.targets.filter(t => t.name === 'media_blob_store').length, 2);
  assert.equal(plan.targets.at(-1).name, 'shard_router');
  assert.equal(plan.openingAuthorized, false);
});
test('missing second-group placement is refused', () => { const f = fixture(); f.page.placements.pop(); assert.throws(() => planProdReleaseTargets(f), /two-group/); });
test('open group is refused', () => { const f = fixture(); f.page.groups[0].accepting = true; assert.throws(() => planProdReleaseTargets(f), /closed/); });
test('foreign live domain is refused even when the independent receipt is valid', () => { const f = fixture(); f.page.placements[1].domains[0].canister = 'foreign-cai'; assert.throws(() => planProdReleaseTargets(f), /differ/); });
test('DEV base address cannot enter PROD release targets', () => { const f = fixture(); f.ids.identity_access = 'mq2sj-fiaaa-aaaal-qxlqa-cai'; assert.throws(() => planProdReleaseTargets(f), /PROD base/); });
test('missing artifact fingerprint refuses partial release', () => { const f = fixture(); delete f.hashes.vault_domain; assert.throws(() => planProdReleaseTargets(f), /artifact/); });
test('the exact 30 October identity source cannot satisfy the installed safeguard pin contract', () => {
  const source = execFileSync('git', ['show', 'd321e85bbcdfbdd7045d5c8fcb57d937df4ac482:backend/identity_access/src/lib.rs'], { encoding: 'utf8' });
  assert.throws(() => assertIdentitySourceSupportsPins(source, { IGNITE_PRODUCTION_ACCOUNT_WITNESS: 'witness-cai' }), /explicit owner decision/);
});
test('retaining current PROD identity excludes it from all 30 other install targets', () => {
  const selected = retainProdIdentity(planProdReleaseTargets(fixture()), 'b'.repeat(64));
  assert.equal(selected.targets.length, 30);
  assert.equal(selected.targets.some(t => t.name === 'identity_access'), false);
  assert.equal(selected.retained[0].newHash, 'b'.repeat(64));
  assert.equal(selected.exactDevParity, false);
});
test('retained identity requires an observed fingerprint, not an assumed one', () => {
  assert.throws(() => retainProdIdentity(planProdReleaseTargets(fixture()), ''), /Observed/);
});
test('historical club interface cannot satisfy newer PROD protected-reader calls', () => {
  const did = execFileSync('git', ['show', 'd321e85bbcdfbdd7045d5c8fcb57d937df4ac482:backend/club_domain/club_domain.did'], { encoding: 'utf8' });
  assert.throws(() => assertRetainedIdentityReceiverCompatibility('"read_account_protection_configuration"', { club_domain: did }), /absent.*club_domain/);
});