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
  assert.match(workflow,/actions: read # Must read authenticated completed main recovery job/);
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
  // The GitHub runner has NO .local-icp/identity-init.bin. The CLI must
  // load reviewed deploy/mainnet/icp.yaml, never repository-root lab icp.yaml.
  assert.match(runner,/const mainnetProject=resolve\(import\.meta\.dirname,'\.\.\/\.\.\/deploy\/mainnet'\)/);
  assert.match(runner,/readFileSync\(join\(mainnetProject,'icp\.yaml'\),'utf8'\)/);
  assert.match(runner,/throw Error\('Expected reviewed deploy\/mainnet ICP project; refusing install before intent'\)/);
  assert.match(runner,/spawnSync\('icp',args,\{cwd:mainnetProject,stdio:'inherit'\}\)/);
  assert.ok(runner.indexOf("const mainnetProject=")<runner.indexOf("journal.stages[stage]={phase:'pending'"),
    'ICP project must be checked before durable pending intent');

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

test('historical DEV persistence checks use the immutable preflight source and never live install',()=>{
  const persistence=readFileSync(new URL('../.github/workflows/dev-first-content-persistence.yml',import.meta.url),'utf8');
  const snapshot='e7b74c79f7604e4383e957c826f5f34e2d4bf2d4';
  assert.match(policy,new RegExp("sourceBaseline: '"+snapshot+"'"));
  assert.match(persistence,new RegExp('ref: '+snapshot));
  assert.match(persistence,/path: first-content-pinned-source/);
  assert.match(persistence,/persist-credentials: false/);
  assert.match(persistence,/\(cd first-content-pinned-source\/deploy\/mainnet && icp build identity_access club_domain\)/);
  assert.match(persistence,/checkedOut!==pins\.sourceBaseline/);
  assert.match(persistence,/verifyExactPreviousWasms/);
  assert.match(persistence,/wasmHash\(bytes\)!==service\.next/);
  assert.match(persistence,/IDENTITY_ACCESS_WASM="\$R\/first-content-pinned-source\/deploy\/mainnet/);
  assert.match(persistence,/CLUB_DOMAIN_WASM="\$R\/first-content-pinned-source\/deploy\/mainnet/);
  assert.doesNotMatch(persistence,/\(cd deploy\/mainnet && icp build identity_access club_domain\)/);
  assert.doesNotMatch(persistence,/GOVERNOR_PEM|DEPLOYER_PEM|icp canister install|icp deploy|icp sync|update_settings/);
  assert.match(persistence,/permissions:\n  contents: read\n  actions: read/);
});
