import test from 'node:test';
import assert from 'node:assert/strict';
import { planSecureNameSave } from './prod-secure-name-save-policy.mjs';

const ids = { identity_access: 'wb3hl-byaaa-aaaai-ayeqa-cai', pii_access_control: 'tihmd-lyaaa-aaaai-ayema-cai' };
const live = (pii, identity) => ({ [ids.pii_access_control]: { environment: pii }, [ids.identity_access]: { environment: identity } });

test('name store first, keeps existing settings, pins each other', () => {
  const plan = planSecureNameSave(ids, live([{ name: 'VETKD_KEY_NAME', value: 'key_1' }], [{ name: 'IGNITE_BOUND_DELETION_RELEASE', value: '1' }]));
  assert.deepEqual(plan.map(p => p.name), ['pii_access_control', 'identity_access']);
  assert.deepEqual(plan[0].next, [
    { name: 'IGNITE_SECURE_ADULT_NAME_IDENTITY', value: ids.identity_access },
    { name: 'IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE', value: '1' },
    { name: 'VETKD_KEY_NAME', value: 'key_1' }]);
  assert.deepEqual(plan[1].next, [
    { name: 'IGNITE_BOUND_DELETION_RELEASE', value: '1' },
    { name: 'IGNITE_SECURE_ADULT_NAME_PII', value: ids.pii_access_control },
    { name: 'IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE', value: '1' }]);
  assert.equal(plan[0].restart, true);
  assert.equal(plan[1].restart, false);
  assert.ok(plan.every(p => !p.done));
});

test('refuses wrong key, foreign pins, rehearsal or unreadable settings', () => {
  assert.throws(() => planSecureNameSave(ids, live([{ name: 'VETKD_KEY_NAME', value: 'test_key_1' }], [])));
  assert.throws(() => planSecureNameSave(ids, live([{ name: 'VETKD_KEY_NAME', value: 'key_1' }], [{ name: 'IGNITE_SECURE_ADULT_NAME_PII', value: 'aaaaa-aa' }])));
  assert.throws(() => planSecureNameSave(ids, live([{ name: 'VETKD_KEY_NAME', value: 'key_1' }, { name: 'X_REHEARSAL', value: '1' }], [])));
  assert.throws(() => planSecureNameSave(ids, { [ids.identity_access]: { environment: [] } }));
});

test('already applied is recognised as done', () => {
  const first = planSecureNameSave(ids, live([{ name: 'VETKD_KEY_NAME', value: 'key_1' }], []));
  const again = planSecureNameSave(ids, live(first[0].next, first[1].next));
  assert.ok(again.every(p => p.done));
});
