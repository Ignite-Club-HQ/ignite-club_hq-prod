import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const script = read('frontend/scripts/disposable-dev-membership-reset.ts');
const wf = read('.github/workflows/dev-disposable-membership-reset.yml');
const backend = read('backend/identity_access/src/lib.rs');
const config = read('backend/identity_access/src/membership_runtime.rs');
const update = read('backend/identity_access/src/membership_updates.rs');
const pool = read('backend/identity_access/src/membership_namespace.rs');
const worker = read('backend/identity_access/src/membership_propagation.rs');
const coordinator = read('backend/identity_access/src/membership_coordinator.rs');
const sessions = read('backend/identity_access/src/membership_private_lookup.rs');

test('cannot execute a DEV reset from PR CI or without manual exact main-branch approval', () => {
  assert.match(wf,/workflow_dispatch:/);
  assert.match(wf,/manually-approved:/);
  assert.match(wf,/if: github.event_name == 'workflow_dispatch'/);
  assert.match(wf,/environment: group-2-admin-controls/);
  assert.match(wf,/test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(wf,/RESET IGNITE DEV DIRECTORY 7 TO 11/);
  assert.match(wf,/group: ignite-mainnet-governor-deployment/);
  assert.doesNotMatch(wf,/push:/);
  assert.match(script,/if\(action==='check'\)/);
  assert.ok(script.indexOf("if(action==='check')") <
    script.indexOf('reset_disposable_dev_membership_directory('));
});
test('backend refuses foreign principals, prod releases, unexpected revisions and source inventories', () => {
  assert.match(backend,/fn reset_disposable_dev_membership_directory/);
  assert.match(backend,/require_governor\(&state\(\),caller\)/);
  assert.match(backend,/production_authorization\(\)\.approval\.is_some\(\)/);
  assert.match(backend,/group_inventory::validate/);
  assert.match(backend,/DIR(E|E)CTORY_TIMER_BUSY/);
  assert.match(config,/pub const DEV_RESET_CONFIRMATION:&str="RESET IGNITE DEV DIRECTORY 7 TO 11"/);
  assert.match(config,/binding.registry_revision!=saved_revision/);
  assert.match(config,/config.release.is_some\(\)/);
  assert.match(config,/current_canister!=dev_identity \|\| caller!=governor/);
  assert.match(config,/config.generation!=1/);
  assert.match(backend,/expected_saved_revision/); // method requires exact observed revision
  assert.doesNotMatch(backend,/fn reset_disposable_dev_membership_directory[\s\S]{0,5000}erase_account\(/);
});
test('directory-only scope, bounded cleanup and anti-replay counters', () => {
  const after = backend.slice(backend.indexOf('async fn reset_disposable_dev_membership_directory('));
  const limited = after.slice(0,after.indexOf('/// Exact operator readback'));
  for(const token of ['DIRECTORY_WORKER','DIRECTORY_SESSIONS','DIRECTORY_COORDINATOR','DIRECTORY_CONFIG','dev_disposal_within_budget','dev_discard_test_directory']) {
    assert.ok(limited.includes(token),token);
  }
  for(const token of ['ACCOUNTS.with','PROFILES.with','PRINCIPAL_INDEX.with','ERASED_ACCOUNTS.with','install_code','set_service_authorities']) {
    assert.ok(!limited.includes(token),'Forbidden '+token);
  }
  assert.match(pool,/next: prior.next, pages: 0/);
  assert.match(coordinator,/dev_discard_test_directory/);
  assert.match(update,/dev_discard_test_updates/);
  assert.match(worker,/dev_discard_test_jobs/);
  assert.match(sessions,/filter\(\|key\| key!=COUNTER\)/);
});
test('rebuild stays unreleased and exact G1/G2 source bindings only', () => {
  assert.match(script,/configure_membership_directory\(binding/);
  assert.match(script,/2n/);
  assert.match(script,/membershipLookupReleased:false/);
  assert.match(script,/!configured.enabled\|\|configured.app_enabled/);
  assert.match(script,/fingerprint\\(current\\)!==fingerprint\\(sourceBefore\\[i\\]\\)/);
  assert.match(script,/configured.binding.registry_revision!==11n/);
  assert.doesNotMatch(script,/enable_membership_directory\(/);
  assert.doesNotMatch(script,/read_private_profile_name_authorization\(/);
  assert.doesNotMatch(script,/open_private_name_writer_window\(/);
});
