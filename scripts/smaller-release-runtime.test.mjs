import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authMethodDestination, destinationOwnedByRuntime, runtimeForPath, safeLocalDestination,
  securePath, secureRequiredInventory } from './smaller-release-runtime.mjs';

test('legacy callback, reset and notification paths retain email ownership', () => {
  for (const p of ['/auth', '/auth?code=callback', '/reset-password', '/vault', '/messages/thread', '/securely']) {
    assert.equal(runtimeForPath(p.split('?')[0]), 'supabase');
  }
  assert.equal(runtimeForPath('/secure/auth'), 'icp');
});
test('method switching drops credentials and backend-specific invite capabilities', () => {
  assert.equal(authMethodDestination('icp', '?mode=signup&invite=private&next=%2Fjoin%2Fprivate&code=secret'), '/secure/auth?mode=signup');
  assert.equal(authMethodDestination('supabase', '?mode=signin&state=secret'), '/auth?mode=signin');
  assert.throws(() => authMethodDestination('other'));
});
test('destinations cannot escape or silently cross document ownership', () => {
  for (const p of ['//evil.test', '/\\evil', 'https://evil.test', '/%2f%2fevil', '/%5cevil', '/x\n']) assert.equal(safeLocalDestination(p), null);
  assert.equal(destinationOwnedByRuntime('/messages/a', 'icp'), false);
  assert.equal(destinationOwnedByRuntime('/secure/teams/a', 'icp'), true);
  assert.equal(securePath('/teams/a?tab=chat'), '/secure/teams/a?tab=chat');
  assert.equal(securePath('/secure/auth'), '/secure/auth');
});
test('secure production readiness rejects missing, duplicate and DEV inventories', () => {
  assert.throws(() => secureRequiredInventory({}, {}));
  const keys = ['identity_access','club_domain','events_domain','messaging_domain','notification_queue','pii_access_control','media_metadata','media_blob_store','competition_domain'];
  const ids = Object.fromEntries(keys.map((k,i) => [k, `aaaaa-aaaaa-aaaaa-aaaa${i}-cai`]));
  assert.equal(secureRequiredInventory(ids, {}).length, 9);
  assert.throws(() => secureRequiredInventory(ids, { identity_access: ids.identity_access }));
  assert.throws(() => secureRequiredInventory({ ...ids, club_domain: ids.identity_access }, {}));
});