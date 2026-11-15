import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const wf=read('.github/workflows/dev-generation2-membership-directory-staging.yml');
const script=read('frontend/scripts/dev-generation2-directory-staging.ts');
const legacy=read('frontend/scripts/release-membership-lookup.ts');

test('protected manual action never runs on PR, cannot target PROD and requires separate fill consent',()=>{
  assert.match(wf,/name: "\[TEST\] DEV generation-2 membership directory staging/);
  assert.match(wf,/workflow_dispatch:/);
  assert.match(wf,/if: github\.event_name == 'workflow_dispatch'/);
  assert.match(wf,/environment: group-2-admin-controls/);
  assert.match(wf,/test "\$\{GITHUB_REPOSITORY,,\}" = "ignite-club-hq\/ignite-club_hq-prod"/);
  assert.match(wf,/test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(wf,/check\) test -z "\$GEN2_CONFIRMATION"/);
  assert.match(wf,/fill\) test "\$GEN2_CONFIRMATION" = "FILL IGNITE DEV MEMBERSHIP DIRECTORY GENERATION 2"/);
  assert.match(wf,/permissions:\n  contents: read/);
  assert.match(wf,/secrets\.GOVERNOR_PEM \|\| secrets\.DEPLOYER_PEM/);
  assert.match(wf,/scripts\/normalize-pem\.mjs/);
  assert.match(wf,/concurrency:/);
  assert.doesNotMatch(wf,/deploy\/prod|PROD_GOVERNOR_PEM|SUPABASE_SERVICE_ROLE_KEY|push:|schedule:/);
});

test('staging script pins the exact rebuilt DEV directory and two original sources',()=>{
  for(const s of ['mq2sj-fiaaa-aaaal-qxlqa-cai','jcdfe-vqaaa-aaaal-qxloq-cai',
    'mzzzv-taaaa-aaaal-qxlrq-cai','yfwyv-nyaaa-aaaal-qxpyq-cai'])assert.ok(script.includes(s));
  assert.match(script,/c\.generation!==2n/);
  assert.match(script,/snapshot\.revision!==11n/);
  assert.match(script,/!c\.enabled \|\| c\.app_enabled/);
  assert.match(script,/grant\.generation!==2n/);
  assert.match(script,/GROUP2_GOVERNOR/);
  assert.match(script,/initialFingerprint/);
  assert.match(script,/if\(action==='check'\)/);
  assert.ok(script.indexOf("if(action==='check')")<script.indexOf('identity.advance_membership_directory_source('));
});

test('fill is bounded, identity-owned and cannot activate a reader or change permissions',()=>{
  assert.match(script,/runFill\(/);
  assert.match(script,/maxCalls:512,retries:2/);
  assert.match(script,/runOwnershipAcceptance\(/);
  assert.match(script,/checkReplicaAcceptance\(/);
  assert.match(script,/readyForReaderRelease:false/);
  assert.match(script,/readerReleased:false/);
  assert.doesNotMatch(script,/\.enable_membership_directory\(|\.configure_membership_directory\(|\.configure_membership_directory_source\(/);
  assert.doesNotMatch(script,/install_code|spawnSync\(|execSync\(|executeUpgrades\(|\.grant_|\.set_|supabase|notify|send_push/gi);
  assert.match(script,/await verifySources\(\)/);
});

test('legacy generation-one release refuses a rebuilt directory before attempting installs',()=>{
  assert.match(legacy,/read_membership_directory_configuration\(\)/);
  assert.match(legacy,/generation===2n/);
  const fence=legacy.indexOf('read_membership_directory_configuration()');
  const install=legacy.indexOf('await executeUpgrades(');
  assert.ok(fence>=0 && install>fence,'generation-2 rejection must precede any install');
});
