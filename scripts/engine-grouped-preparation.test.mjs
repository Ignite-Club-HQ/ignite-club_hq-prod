import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGroupedEngineDraft, createGroupedUpdateCandidate, groupedPlanHash, assessGroupedEngineReadiness,
  assessGroupedAcceptance, GROUPED_ENGINE_SCENARIOS, ENGINE_SUBNET } from './engine-grouped-preparation.mjs';
import { ENGINE_OWNER, DEV_GOVERNOR, WEB_APP_KEY } from './engine-browser/engine-controller-policy.mjs';

const observation = JSON.parse(readFileSync(new URL('../docs/dev-engine-combined-installation-observation.json', import.meta.url)));
const time = { now: 10000, maxAgeMs: 500 };
function fixture() {
  const plan = createGroupedEngineDraft(observation);
  plan.registryRevision = '9007199254740993';
  plan.services.forEach((s, i) => {
    // Synthetic IDs for policy tests only; no principal/certificate claim.
    s.canisterId = `fixture-${i}-cai`; s.reviewedModuleHash = 'a'.repeat(64);
  });
  const capture = { schema: 1, source: 'owner-capture', planHash: groupedPlanHash(plan), observedAtMs: 10000,
    receipt: 'local-fixture-not-live-proof', closedRegistryMatchesPlan: true, originalKeyContinuityVerified: true,
    services: plan.services.map(s => ({ ...s, subnetId: ENGINE_SUBNET, moduleHash: s.reviewedModuleHash,
      status: 'running', controllers: s.service === 'frontend' ? [ENGINE_OWNER, DEV_GOVERNOR, WEB_APP_KEY] : [ENGINE_OWNER, DEV_GOVERNOR],
      internalGovernor: DEV_GOVERNOR, configurationMatchesPlan: true })) };
  return { plan, capture };
}
test('two groups reuse 19 existing references and add exactly 13 group-owned parts', () => {
  const p = createGroupedEngineDraft(observation);
  assert.equal(p.services.length, 32);
  assert.equal(p.services.filter(s => s.canisterId).length, 19);
  assert.equal(p.services.filter(s => s.scope === 'shared').length, 6);
  for (const g of ['g1', 'g2']) {
    assert.equal(p.services.filter(s => s.scope === g).length, 13);
    assert.equal(p.services.filter(s => s.scope === g && s.service === 'media_blob_store').length, 1);
    assert.equal(p.services.filter(s => s.scope === g && s.service === 'pii_access_control').length, 1);
  }
  assert.ok(assessGroupedEngineReadiness(p, null, time).blockers.includes('complete-unique-32-canister-inventory-required'));
});
test('complete supplied observations never authorize deployment, promotion or activation', () => {
  const { plan, capture } = fixture(); const r = assessGroupedEngineReadiness(plan, capture, time);
  assert.equal(r.suppliedReadinessChecksPassed, true);
  for (const key of ['activationAuthorized', 'promotionAuthorized', 'deploymentAuthorized', 'independentlyVerified', 'liveReadPerformed']) assert.equal(r[key], false);
});
test('PROD context is refused', () => {
  const { plan, capture } = fixture(); plan.branch = 'prod';
  assert.throws(() => assessGroupedEngineReadiness(plan, capture, time), /DEV/);
});
test('single-group inventory is refused', () => {
  const { plan } = fixture(); plan.services = plan.services.filter(s => s.scope !== 'g2');
  assert.throws(() => groupedPlanHash(plan), /two thirteen/);
});
test('groups cannot share a photo store ID', () => {
  const { plan, capture } = fixture();
  plan.services.find(s => s.scope === 'g2' && s.service === 'media_blob_store').canisterId =
    plan.services.find(s => s.scope === 'g1' && s.service === 'media_blob_store').canisterId;
  assert.ok(assessGroupedEngineReadiness(plan, capture, time).blockers.includes('complete-unique-32-canister-inventory-required'));
});
test('code artifacts must match across groups', () => {
  const { plan, capture } = fixture(); plan.services.find(s => s.scope === 'g2').reviewedModuleHash = 'b'.repeat(64);
  assert.ok(assessGroupedEngineReadiness(plan, capture, time).blockers.includes('reviewed-matching-group-artifacts-required'));
});
test('owner-only controllers still block GitHub updates', () => {
  const { plan, capture } = fixture(); capture.services[0].controllers = [ENGINE_OWNER];
  assert.ok(assessGroupedEngineReadiness(plan, capture, time).blockers.includes('shared/frontend:controller-permissions-unverified'));
});
test('management control does not imply internal governor authority', () => {
  const { plan, capture } = fixture(); capture.services.find(s => s.service === 'identity_access').internalGovernor = ENGINE_OWNER;
  assert.ok(assessGroupedEngineReadiness(plan, capture, time).blockers.includes('shared/identity_access:internal-governor-unverified'));
});
test('engine zero cycles need no top-up and do not certify wiring', () => {
  const { plan, capture } = fixture(); capture.services.forEach(s => { s.cycles = '0'; });
  assert.equal(assessGroupedEngineReadiness(plan, capture, time).suppliedReadinessChecksPassed, true);
  capture.services.find(s => s.service === 'club_domain').configurationMatchesPlan = false;
  assert.ok(assessGroupedEngineReadiness(plan, capture, time).blockers.includes('g1/club_domain:service-wiring-unverified'));
});
test('old or wrong-bound captures cannot pass', () => {
  for (const patch of [{ observedAtMs: 9499 }, { observedAtMs: 10001 }, { planHash: 'b'.repeat(64) }, { source: 'fixture' }]) {
    const { plan, capture } = fixture(); Object.assign(capture, patch);
    assert.ok(assessGroupedEngineReadiness(plan, capture, time).blockers.includes('fresh-exact-bound-owner-capture-required'));
  }
});
test('revision remains exact decimal text and order does not alter binding', () => {
  const { plan } = fixture(); const h = groupedPlanHash(plan); plan.services.reverse();
  assert.equal(groupedPlanHash(plan), h); plan.registryRevision = '9007199254740994';
  assert.notEqual(groupedPlanHash(plan), h);
});
test('key continuity and closed registry are separate requirements', () => {
  const { plan, capture } = fixture(); capture.originalKeyContinuityVerified = false; capture.closedRegistryMatchesPlan = false;
  const r = assessGroupedEngineReadiness(plan, capture, time);
  assert.ok(r.blockers.includes('original-engine-photo-key-continuity-unverified'));
  assert.ok(r.blockers.includes('closed-two-group-registry-unverified'));
});
const records = plan => GROUPED_ENGINE_SCENARIOS.map(scenario => ({ scenario, planHash: groupedPlanHash(plan),
  source: 'engine-capture', observedAtMs: 10000, passed: true, receipt: 'local-fixture-not-live-proof' }));
test('both groups require real gallery and document scenarios; fixtures do not complete acceptance', () => {
  const { plan } = fixture(); const rs = records(plan); rs.forEach(r => { r.source = 'fixture'; });
  const result = assessGroupedAcceptance(plan, rs, time);
  assert.equal(result.pending.length, 18);
  for (const scenario of ['g1-gallery-fresh-authorized-decryption', 'g2-gallery-fresh-authorized-decryption',
    'g1-chat-document-mime-and-bytes', 'g2-chat-document-mime-and-bytes']) assert.ok(result.pending.includes(scenario));
});
test('complete caller-supplied scenario records still require independent verification', () => {
  const { plan } = fixture(); const r = assessGroupedAcceptance(plan, records(plan), time);
  assert.equal(r.suppliedScenarioRecordsComplete, true); assert.equal(r.activationAuthorized, false);
  assert.equal(r.signedInFlowVerifiedByThisTool, false); assert.equal(r.externalVerificationRequired, true);
});
test('duplicate scenarios refuse and failed or stale denials remain pending', () => {
  const { plan } = fixture(); const rs = records(plan);
  assert.throws(() => assessGroupedAcceptance(plan, [rs[0], rs[0]], time), /unique/);
  rs.find(r => r.scenario === 'outsider-name-photo-document-denial').passed = false;
  rs.find(r => r.scenario === 'removed-member-fresh-key-denial').observedAtMs = 9499;
  assert.deepEqual(assessGroupedAcceptance(plan, rs, time).pending,
    ['outsider-name-photo-document-denial', 'removed-member-fresh-key-denial']);
});
const group2 = JSON.parse(readFileSync(new URL('../docs/dev-engine-group2-owner-inventory.json', import.meta.url)));
test('owner screenshot maps all thirteen Group 2 services exactly without claiming verification', () => {
  const expected = {
  "messaging_domain": "dc4y3-hiaaa-aaac5-aadjq-cai",
  "vault_domain": "dx3jw-gaaaa-aaac5-aadka-cai",
  "events_domain": "dq2pc-lyaaa-aaac5-aadkq-cai",
  "club_domain": "dzze6-5qaaa-aaac5-aadla-cai",
  "notification_queue": "d6yck-qiaaa-aaac5-aadlq-cai",
  "mini_league_domain": "ctwge-7aaaa-aaac5-aadma-cai",
  "media_metadata": "cuxaq-syaaa-aaac5-aadmq-cai",
  "insights_domain": "c5ulm-eqaaa-aaac5-aadna-cai",
  "timer_jobs": "c2vny-jiaaa-aaac5-aadnq-cai",
  "club_points_domain": "cps4v-iaaaa-aaac5-aadoa-cai",
  "media_blob_store": "cit2b-fyaaa-aaac5-aadoq-cai",
  "pii_access_control": "cbqr5-tqaaa-aaac5-aadpa-cai",
  "competition_domain": "cgrxj-6iaaa-aaac5-aadpq-cai"
};
  const p = createGroupedEngineDraft(observation, group2);
  assert.deepEqual(Object.fromEntries(p.services.filter(s => s.scope === 'g2').map(s => [s.service, s.canisterId])), expected);
  assert.equal(new Set(p.services.map(s => s.canisterId)).size, 32);
  for (const row of p.services.filter(s => s.scope !== 'g2')) assert.equal(row.canisterId, observation[row.service].id);
  assert.equal(p.independentlyVerified, false);
  assert.ok(p.services.every(s => s.reviewedModuleHash === null));
  assert.equal(assessGroupedEngineReadiness(p, null, time).suppliedReadinessChecksPassed, false);
});
test('owner inventory refuses missing, extra, duplicate, reused and malformed IDs or claimed verification', () => {
  const variants = [
    g => { delete g.canisterIds.events_domain; }, g => { g.canisterIds.frontend = observation.frontend.id; },
    g => { g.canisterIds.events_domain = g.canisterIds.club_domain; },
    g => { g.canisterIds.club_domain = observation.club_domain.id; },
    g => { g.canisterIds.club_domain = 'not-a-principal'; }, g => { g.independentlyVerified = true; },
  ];
  for (const mutate of variants) {
    const g = structuredClone(group2); mutate(g);
    assert.throws(() => createGroupedEngineDraft(observation, g), /thirteen unique/);
  }
});
test('update review includes 32 targets, two stores, DEV database and no activation authority', () => {
  const plan = createGroupedEngineDraft(observation, group2);
  const candidate = createGroupedUpdateCandidate(plan);
  assert.equal(candidate.targets.length, 32);
  assert.equal(candidate.targets.filter(s => s.service === 'media_blob_store').length, 2);
  assert.equal(candidate.database, 'https://ecsdwrarzfexssxtrymj.supabase.co');
  assert.equal(candidate.frontend, '7pfcq-raaaa-aaac5-aabia-cai');
  assert.equal(candidate.branch, 'main');
  assert.equal(candidate.planHash, groupedPlanHash(plan));
  for (const key of ['enabled', 'activationAuthorized', 'deploymentAuthorized', 'promotionAuthorized', 'liveReadPerformed']) assert.equal(candidate[key], false);
  assert.equal(candidate.updateMode, 'upgrade-only-preserve-state');
  assert.equal(candidate.targets.filter(s => s.proposedConsoleMetadata.__META_MAIN_CANISTER === 'true').length, 1);
  assert.ok(candidate.targets.every(s => s.proposedConsoleMetadata.__META_PROJECT === 'ignite_dev'));
  for (const t of candidate.targets) assert.deepEqual(t.requiredControllers,
    t.service === 'frontend' ? [ENGINE_OWNER, DEV_GOVERNOR, WEB_APP_KEY] : [ENGINE_OWNER, DEV_GOVERNOR]);
});
test('update preparation refuses PROD, missing Group 2 and drifted existing DEV targets', () => {
  assert.throws(() => createGroupedUpdateCandidate(createGroupedEngineDraft(observation)), /inventory/);
  const p = createGroupedEngineDraft(observation, group2); p.branch = 'prod';
  assert.throws(() => createGroupedUpdateCandidate(p), /DEV/);
  p.branch = 'main'; p.services.find(s => s.scope === 'g1' && s.service === 'club_domain').canisterId = 'wrong-target-cai';
  assert.throws(() => createGroupedUpdateCandidate(p), /DEV services/);
});
