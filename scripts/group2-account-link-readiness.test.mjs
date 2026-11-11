import test from 'node:test';
import assert from 'node:assert/strict';
import { group2AccountLinkReadiness } from './group2-account-link-readiness.mjs';

const eligible = [['account_admission_released','true'], ['ordinary_member_access','false']];
const verified = {status:'verified',accountId:'test-123',identityAccountId:'test-123'};

test('eligibility without ordinary member access cannot be described as linked', () => {
  const r = group2AccountLinkReadiness(eligible);
  assert.equal(r.eligibility,true);
  assert.equal(r.memberAccess,false);
  assert.equal(r.ready,false);
  assert.equal(r.status,'member_access_not_commissioned');
  assert.match(r.action,/Eligibility reader authorization alone/);
});

test('ordinary access requires independent signed-in linked-account readback', () => {
  const rows=[['account_admission_released','true'],['ordinary_member_access','true']];
  assert.equal(group2AccountLinkReadiness(rows).ready,false);
  assert.equal(group2AccountLinkReadiness(rows,{...verified,identityAccountId:'different'}).ready,false);
  assert.equal(group2AccountLinkReadiness(rows,verified).ready,true);
});

test('signed-in readback does not substitute for verified release mode', () => {
  const r=group2AccountLinkReadiness(eligible,verified);
  assert.equal(r.ready,false);
  assert.equal(r.status,'read_verified_but_release_unknown');
});

test('conflicting signed configuration is always rejected', () => {
  const rows=[...eligible,['ordinary_member_access','true']];
  assert.equal(group2AccountLinkReadiness(rows,verified).status,'invalid_evidence');
  assert.equal(group2AccountLinkReadiness(rows,verified).ready,false);
});
