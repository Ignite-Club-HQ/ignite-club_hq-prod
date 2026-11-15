import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const script=read('frontend/scripts/dev-generation2-directory-reader-release.ts');
const workflow=read('.github/workflows/dev-generation2-membership-reader-release.yml');

test('release cannot run on a PR and requires protected exact DEV action',()=>{
  assert.match(workflow,/name: "\[TEST\] DEV generation-2 private membership reader release"/);
  assert.match(workflow,/if: github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow,/environment: group-2-admin-controls/);
  assert.match(workflow,/permissions:\n  contents: read/);
  assert.match(workflow,/concurrency:/);
  assert.match(workflow,/test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow,/test "\$\{GITHUB_REPOSITORY,,\}" = "ignite-club-hq\/ignite-club_hq-prod"/);
  assert.match(workflow,/check\)\s+test -z "\$GEN2_CHECKED_PLAN"/);
  assert.match(workflow,/test -z "\$GEN2_CONFIRMATION"/);
  assert.match(workflow,/release\)\s+\[\[ "\$GEN2_CHECKED_PLAN" =~ \^\[a-f0-9\]\{64\}\$ \]\]/);
  assert.match(workflow,/RELEASE IGNITE DEV MEMBERSHIP LOOKUP GENERATION 2/);
  assert.match(workflow,/secrets\.GOVERNOR_PEM \|\| secrets\.DEPLOYER_PEM/);
  assert.match(workflow,/scripts\/normalize-pem\.mjs/);
  assert.doesNotMatch(workflow,/deploy\/prod|PROD_GOVERNOR_PEM|SUPABASE_SERVICE_ROLE_KEY|permissions:\n  contents: write/);
});

test('release target, rev, generation and closure preflight are all pinned',()=>{
  for(const id of [
    'mq2sj-fiaaa-aaaal-qxlqa-cai','jcdfe-vqaaa-aaaal-qxloq-cai',
    'mzzzv-taaaa-aaaal-qxlrq-cai','yfwyv-nyaaa-aaaal-qxpyq-cai',
    'zt5a6-yiaaa-aaaal-qxp5q-cai',
  ])assert.ok(script.includes(id));
  assert.match(script,/governor\.getPrincipal\(\)\.toText\(\)!==GROUP2_GOVERNOR/);
  assert.match(script,/s\.revision!==11n/);
  assert.match(script,/c\.generation!==2n/);
  assert.match(script,/c\.app_enabled!==expectedReleased/);
  assert.match(script,/grant\.generation!==2n/);
  assert.match(script,/status\.acknowledged!==status\.revision \|\| status\.pending!==false/);
  assert.match(script,/check_membership_directory_acceptance\(\)/);
  assert.match(script,/snapshot_verified/);
  assert.match(script,/restoration_guard_verified/);
  assert.match(script,/initialDirectoryFingerprint/);
  assert.match(script,/initialRouterFingerprint/);
});

test('only one write operation may enable the DEV membership reader after checked plan',()=>{
  assert.match(script,/checkedPlan!==planHash/);
  assert.match(script,/checkedPlan!==''/);
  assert.match(script,/createHash\('sha256'\)/);
  assert.match(script,/releaseCommit:commit/);
  assert.match(script,/action==='check'/);
  assert.match(script,/process\.exit\(0\)/);
  assert.match(script,/intent-before-one-identity-call/);
  assert.match(script,/identity\.enable_membership_directory\(commit\)/);
  assert.equal((script.match(/identity\.enable_membership_directory\(/g)||[]).length,1);
  assert.ok(script.indexOf("if(action==='check')")<script.indexOf('identity.enable_membership_directory('));
  assert.ok(script.indexOf('checkedPlan!==planHash')<script.indexOf('identity.enable_membership_directory('));
  assert.match(script,/verifyDirectory\(true\)/);
  assert.match(script,/realUserPageTested:false/);
  assert.match(script,/privateNamesReleased:false/);
  assert.doesNotMatch(script,/\.configure_membership_directory\(|\.configure_membership_directory_source\(|\.advance_membership_directory_source\(|\.advance_membership_directory_ownership\(|install_code|executeUpgrades\(|spawnSync\(|createSupabaseClient/);
});
