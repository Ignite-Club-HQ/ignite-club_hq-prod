import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyControl, CONTROL_READERS } from './prod-control-record-policy.mjs';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
const configured = [
  { name: 'IGNITE_ACCOUNT_ADMISSION_RELEASE', value: '1' },
  { name: 'IGNITE_ACCOUNT_REMOVAL_RELEASE', value: '1' },
  { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: PROD_CHECK_IDS.identity_access },
];
test('no enabled protection cannot confirm control use', () => assert.equal(classifyControl('club_domain', [], true), 'PROTECTION_NOT_ENABLED'));
test('missing signed approval never confirms control use', () => assert.equal(classifyControl('club_domain', configured, false), 'NO_CONFIRMED_SIGNED_CONTROL_RECORD'));
test('settings and approval alone remain insufficient', () => assert.equal(classifyControl('club_domain', configured, true), 'CONFIGURED_EFFECTIVE_READBACK_STILL_REQUIRED'));
test('unknown settings fail closed', () => assert.equal(classifyControl('club_domain', null, true), 'UNVERIFIED'));
test('read-only method set excludes review and authorisation writers', () => assert.deepEqual(CONTROL_READERS, ['read_production_account_authorization', 'canister_status', 'list_groups']));