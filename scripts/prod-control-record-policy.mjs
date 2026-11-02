import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
export const CONTROL_READERS = Object.freeze(['read_production_account_authorization', 'canister_status', 'list_groups']);
export function classifyControl(name, environment, approval) {
  if (['placement_registry', 'migration_coordinator'].includes(name)) return 'NOT_A_CONTROL_RECEIVER';
  if (!environment) return 'UNVERIFIED';
  const get = key => environment.find(row => row.name === key)?.value;
  if (get('IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL') === '1') return 'REHEARSAL_NOT_PRODUCTION';
  if (get('IGNITE_ACCOUNT_ADMISSION_RELEASE') !== '1' || get('IGNITE_ACCOUNT_REMOVAL_RELEASE') !== '1') return 'PROTECTION_NOT_ENABLED';
  if (get('IGNITE_ACCOUNT_SERVICE_IDENTITY') !== PROD_CHECK_IDS.identity_access) return 'AUTHORITY_NOT_BOUND';
  return approval === true ? 'CONFIGURED_EFFECTIVE_READBACK_STILL_REQUIRED' : 'NO_CONFIRMED_SIGNED_CONTROL_RECORD';
}