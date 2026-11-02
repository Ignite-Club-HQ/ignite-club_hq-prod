import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLifecycleWiring, assertWiringApproval, WIRING_CONFIRMATION, WIRING_METHODS } from './prod-lifecycle-wiring-policy.mjs';

const ids = { identity_access: 'iden-cai' };
const diag = (group, service, canisterId, bindings) => ({ group, service, canisterId, bindings });
const review = { diagnostics: [
  diag('base', 'club_domain', 'club-cai', [
    { setting: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', expected: '1', result: 'missing' },
    { setting: 'identity_access', expected: 'iden-cai', result: 'missing' },
    { setting: 'media_store', expected: 'store-cai', result: 'missing' },
    { setting: 'competition_authority', expected: 'comp-cai', result: 'different' }]),
  diag('base', 'media_blob_store', 'store-cai', []),
  diag('base', 'competition_domain', 'comp-cai', []),
  diag('base', 'timer_jobs', 'timer-cai', [{ setting: 'worker:*', expected: 'push-p', result: 'missing' }]),
] };

test('plans only missing additive links and worker grants', () => {
  const plan = planLifecycleWiring(review, { ids, pushWorker: 'push-p' });
  assert.deepEqual(plan.ready.map(o => `${o.service}.${o.method}=${o.argument}`), [
    'club_domain.register_media_quota_store=store-cai',
    'timer_jobs.grant_worker=push-p']);
  assert.equal(plan.executes, false);
});

test('never overwrites a different value and holds the removal switch', () => {
  const plan = planLifecycleWiring(review, { ids, pushWorker: 'push-p' });
  assert.ok(plan.unknown.some(u => u.setting === 'competition_authority'));
  assert.equal(plan.held.length, 2);
  assert.ok(!plan.ready.some(o => /REHEARSAL/.test(o.setting)));
});

test('missing push worker is never guessed', () => {
  const plan = planLifecycleWiring(review, { ids });
  assert.ok(!plan.ready.some(o => o.method === 'grant_worker'));
});

test('gallery authority is never pointed at the blob store', () => {
  const plan = planLifecycleWiring(review, { ids, pushWorker: 'push-p' });
  assert.ok(!plan.ready.some(o => o.method === 'set_gallery_media_authority'));
  assert.ok(!plan.ready.some(o => o.method === 'set_identity_access_canister'));
});

test('apply needs the exact hash, confirmation and closed groups', () => {
  const plan = planLifecycleWiring(review, { ids, pushWorker: 'push-p' });
  const ok = { reviewedHash: plan.planSha256, confirmation: WIRING_CONFIRMATION, groups: [{ id: 'base', accepting: false }] };
  assert.equal(assertWiringApproval(plan, ok), true);
  assert.throws(() => assertWiringApproval(plan, { ...ok, confirmation: 'yes' }), /Exact confirmation/);
  assert.throws(() => assertWiringApproval(plan, { ...ok, reviewedHash: 'a'.repeat(64) }), /changed since review/);
  assert.throws(() => assertWiringApproval(plan, { ...ok, groups: [{ id: 'base', accepting: true }] }), /CLOSED/);
});

test('every advertised ready call is executable; unaudited competition setter stays held', () => {
  const input = structuredClone(review);
  input.diagnostics[0].bindings.find(b => b.setting === 'competition_authority').result = 'missing';
  const plan = planLifecycleWiring(input, { ids, pushWorker: 'push-p' });
  assert.ok(plan.ready.length > 0);
  assert.ok(plan.ready.every(o => WIRING_METHODS.includes(o.method)));
  assert.ok(plan.unknown.some(o => o.setting === 'competition_authority'));
});
