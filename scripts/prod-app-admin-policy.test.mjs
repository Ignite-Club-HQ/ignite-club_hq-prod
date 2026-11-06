import test from 'node:test';
import assert from 'node:assert/strict';
import { PAUL_PROD_PRINCIPAL as principal, ADMIN_TARGETS, selectPaulAccount, alignAdmin } from './prod-app-admin-policy.mjs';
const row = () => ({ account_id: 'existing-paul-account', status: { Active: null }, principals: [{ toText: () => principal }], roles: [] });
test('only the exact authorised production login is accepted', () => {
  assert.equal(selectPaulAccount([row()], principal).account_id, 'existing-paul-account');
  assert.throws(() => selectPaulAccount([row()], 'another-login'));
});
test('missing duplicate and suspended accounts cannot receive grants', () => {
  assert.throws(() => selectPaulAccount([], principal));
  assert.throws(() => selectPaulAccount([row(), row()], principal));
  assert.throws(() => selectPaulAccount([{ ...row(), status: { Suspended: null } }], principal));
});
function setup() {
  const account = row(), admins = new Map(ADMIN_TARGETS.insights.map(id => [id, []])), writes = [];
  return { writes, principal, confirmation: 'GRANT PAUL PROD APP ADMIN', readAccount: async () => [account], readAdmins: async id => admins.get(id),
    grantIdentity: async id => { writes.push(['identity', id]); account.roles.push({ role: 'app_admin', club: [], team: [], site_id: [] }); },
    grantInsights: async (id, p) => { writes.push([id, p]); admins.get(id).push(p); } };
}
test('check performs no permission writes', async () => {
  const s = setup(); const r = await alignAdmin({ ...s, action: 'check' });
  assert.equal(r.identityAdmin, false); assert.deepEqual(s.writes, []);
});
test('grant changes only existing account and both production admin lists; repeat is a no-op', async () => {
  const s = setup(); const r = await alignAdmin({ ...s, action: 'grant' });
  assert.equal(r.identityAdmin, true); assert.deepEqual(r.insightsAdmins, [true, true]);
  assert.deepEqual(s.writes, [['identity', 'existing-paul-account'], ...ADMIN_TARGETS.insights.map(id => [id, principal])]);
  await alignAdmin({ ...s, action: 'grant' }); assert.equal(s.writes.length, 3);
});
test('grant requires exact confirmation and verifies readback', async () => {
  const s = setup(); await assert.rejects(alignAdmin({ ...s, action: 'grant', confirmation: '' })); assert.equal(s.writes.length, 0);
  await assert.rejects(alignAdmin({ ...s, action: 'grant', grantIdentity: async () => {} }), /readback incomplete/);
});