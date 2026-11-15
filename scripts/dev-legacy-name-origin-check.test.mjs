import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../frontend/scripts/check-dev-legacy-adult-name-origin.ts', import.meta.url),'utf8');
const workflow = readFileSync(new URL('../.github/workflows/dev-legacy-g1-name-origin-check.yml', import.meta.url),'utf8');

test('live check explicitly pins original G1, registered G2 and original governor', () => {
  for (const id of [
    'mzzzv-taaaa-aaaal-qxlrq-cai', 'iui5p-aaaaa-aaaal-qxllq-cai',
    'yfwyv-nyaaa-aaaal-qxpyq-cai', 'zt5a6-yiaaa-aaaal-qxp5q-cai',
    'mq2sj-fiaaa-aaaal-qxlqa-cai','jcdfe-vqaaa-aaaal-qxloq-cai',
  ]) assert.ok(script.includes(id), 'Missing original pinned DEV service: '+id);
  assert.match(script,/operator\.getPrincipal\(\)\.toText\(\) !== GROUP2_GOVERNOR/);
  assert.match(script,/refs\/heads\/main/);
  assert.match(script,/readPinnedGroupRegistry/);
  assert.match(script,/read_membership_directory_configuration/);
  assert.match(script,/pii_vetkey_verification_key/);
  assert.match(script,/inspectLegacyGroup1TeamNameTopology/);
  assert.match(script,/originalKeyMatchesHistoricalBaseline:false/);
  assert.match(script,/readyToReleaseName:false/);
  assert.match(script,/nameReadAuthorised:false/);
});
test('workflow is read-only, owner protected and never uses a deployment token', () => {
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/pull_request:/);
  assert.doesNotMatch(workflow,/\n  push:/);
  assert.match(workflow,/environment: group-2-admin-controls/);
  assert.match(workflow,/group: ignite-mainnet-governor-deployment/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/permissions:\n  contents: read/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/CHECK LEGACY G1 SOURCE ONLY/);
  assert.match(workflow,/if: github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow,/Destroy signing credentials/);
  assert.doesNotMatch(workflow,/icp canister install|icp deploy|upgrade canister|icp build|git push/);
  assert.doesNotMatch(script,/\b(?:set_profile|register_pii|refresh_private_club_name_lifecycle|set_service_authorities|register_group|set_role|grant_pii_read_club)\s*\(/);
  assert.doesNotMatch(script,/\.install\s*\(|\.upgrade\s*\(/);
});
test('live check never accepts a guessed missing G1 placement or audience token', () => {
  assert.doesNotMatch(script,/register_group_placement|configure_membership_directory|enable_membership_directory|rotate_key|grant_pii/);
  assert.match(script,/originalPiiIdentityAllowlistVerified:false/);
  assert.match(script,/teamOnlyNamePermissionVerified:false/);
  assert.doesNotMatch(script,/localStorage|sessionStorage|display_name|child_id|email/);
});
