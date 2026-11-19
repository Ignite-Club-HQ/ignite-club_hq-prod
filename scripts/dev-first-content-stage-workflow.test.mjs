import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/dev-first-content-staged-upgrade.yml',import.meta.url),'utf8');
const runner=readFileSync(new URL('../frontend/scripts/dev-first-content-staged-upgrade.ts',import.meta.url),'utf8');
const policy=readFileSync(new URL('./dev-first-content-stage-policy.mjs',import.meta.url),'utf8');

test('new DEV stage workflow is manual-only, check-default, protected and serialized',()=>{
  assert.match(workflow,/on:\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow,/\n  push:/);
  assert.match(workflow,/default: check/);
  assert.match(workflow,/options: \[check, upgrade\]/);
  assert.match(workflow,/options: \[identity, g2_club\]/);
  assert.match(workflow,/environment: group-2-admin-controls/);
  assert.match(workflow,/recovery_run_id:/);
  assert.match(workflow,/if: inputs.action == 'upgrade'\n        run: \|\n          set -euo pipefail\n          \[\[ "\$RECOVERY_RUN_ID"/);
  assert.match(workflow,/assertRecoveryRunMetadata\(run\)/);
  assert.match(workflow,/gh run download "\$RECOVERY_RUN_ID"/);
  assert.match(workflow,/verifyExactPreviousWasms/);
  assert.match(workflow,/group: ignite-mainnet-governor-deployment/);
  assert.match(workflow,/test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow,/upgrade-all-groups\.ts check dev_first_content_admission_preflight/);
});
test('only one approved install is possible; no implicit other-canister writes or recovery',()=>{
  assert.equal((runner.match(/spawnSync\('icp',args/g)??[]).length,1);
  assert.match(runner,/persistGroup2Journal\(api,path,branch,stored,journal,'first-content '\+stage\+' install intent'\)/);
  assert.match(runner,/pending intent retained\. DO NOT RETRY/);
  assert.match(runner,/if\(journal\.stages\?\.\[stage\]\)throw Error\('Stage has a prior intent/);
  assert.match(runner,/const expectedBefore=stage==='identity'\?\[pins\.identity\.old,pins\.club\.old\]:\[pins\.identity\.next,pins\.club\.old\]/);
  assert.match(runner,/verifyUpgradeStatus\(/);
  assert.match(runner,/IGNITE_FIRST_CONTENT_COMBINED_ADMISSION/);
  assert.match(runner,/if\(!previousWasmDirectory\)throw Error/);
  assert.match(runner,/verifyExactPreviousWasms\(\{/);
  assert.match(runner,/get\('subnet'\)/);
  assert.doesNotMatch(runner,/update_settings|set_pii_canister|set_service_authorities|update_settings|icp deploy|icp sync|stopCanister|upgradeCanister/);
  assert.match(policy,/dev_first_content_admission_preflight/);
  assert.match(policy,/UPGRADE EXACT DEV SHARED IDENTITY FIRST/);
  assert.match(policy,/UPGRADE EXACT DEV GROUP 2 CLUB SECOND/);
});
test('stages do not reuse old preflight hash as the upgrade approval plan',()=>{
  assert.match(policy,/preflightPlan:report\.planHash/);
  assert.match(policy,/const planHash=digest\(binding\)/);
  assert.match(policy,/checkedPlan!==planHash/);
  assert.match(policy,/current\.moduleHash!==expected\(stage,s\)/);
});
