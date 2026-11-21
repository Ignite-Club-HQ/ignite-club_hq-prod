import test from 'node:test';
import assert from 'node:assert/strict';
import { DEV_ADMIN_IDS, assertDevAdminContext, selectExactAdminAccount } from './dev-app-admin-policy.mjs';
const target = 'tavrz-s2z7n-5jkdv-dpho3-pvd3c-yog77-euqar-egkuv-xbzei-ftw3d-eqe';
const row = (id, principal, status = { Active: null }) => ({ account_id: id, principals: [{ toText: () => principal }], status });
test('new Paul login resolves its salted account, never another Paul or the derived original', () => {
  assert.equal(selectExactAdminAccount([row('other', 'mbrvi'), row('a640503e-201c-6662-6f01-98d1b690a40a', target)], target).account_id, 'a640503e-201c-6662-6f01-98d1b690a40a');
});
test('missing, duplicate and suspended owners cannot receive grants', () => {
  for (const rows of [[], [row('a', target), row('b', target)], [row('a', target, { Suspended: null })]]) assert.throws(() => selectExactAdminAccount(rows, target));
});
test('DEV grant refuses prod branch, foreign governor and changed service mappings', () => {
  const governor = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
  assertDevAdminContext({ GITHUB_REF: 'refs/heads/main' }, DEV_ADMIN_IDS, governor);
  assert.throws(() => assertDevAdminContext({ GITHUB_REF: 'refs/heads/prod' }, DEV_ADMIN_IDS, governor));
  assert.throws(() => assertDevAdminContext({ GITHUB_REF: 'refs/heads/main' }, DEV_ADMIN_IDS, 'other'));
  for (const name of Object.keys(DEV_ADMIN_IDS)) assert.throws(() => assertDevAdminContext({ GITHUB_REF: 'refs/heads/main' }, { ...DEV_ADMIN_IDS, [name]: 'prod' }, governor));
});