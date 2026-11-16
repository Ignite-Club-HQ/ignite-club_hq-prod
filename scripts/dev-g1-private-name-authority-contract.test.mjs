import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=s=>readFileSync(new URL('../'+s,import.meta.url),'utf8');
const runner=read('frontend/scripts/audit-dev-g1-private-name-authority.ts');
const workflow=read('.github/workflows/dev-g1-private-name-authority-audit.yml');

test('manual audit pinned to exact original DEV main and governor; PR cannot read canisters',()=>{
  assert.match(workflow,/name: "\[TEST\] DEV original G1 PII authority/);
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/if: github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow,/environment: group-2-admin-controls/);
  assert.match(workflow,/permissions:\n  contents: read/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/group: ignite-mainnet-governor-deployment/);
  assert.match(workflow,/test "\$\{GITHUB_REPOSITORY,,\}" = "ignite-club-hq\/ignite-club_hq-prod"/);
  assert.match(workflow,/test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow,/AUDIT DEV ORIGINAL G1 PII AUTHORITY READ ONLY/);
  assert.doesNotMatch(workflow,/\n  push:|\n  schedule:|permissions:\n  contents: write/);
});

test('exact real DEV topology and two independently authenticated authority readbacks are enforced',()=>{
  for(const id of [
    'mzzzv-taaaa-aaaal-qxlrq-cai','iui5p-aaaaa-aaaal-qxllq-cai',
    'yfwyv-nyaaa-aaaal-qxpyq-cai','zt5a6-yiaaa-aaaal-qxp5q-cai',
    'mq2sj-fiaaa-aaaal-qxlqa-cai','jcdfe-vqaaa-aaaal-qxloq-cai',
  ])assert.ok(runner.includes(id),id);
  assert.match(runner,/GROUP2_GOVERNOR/);
  assert.match(runner,/inspectLegacyGroup1TeamNameTopology/);
  assert.match(runner,/readerRouterAuthorityFingerprint/);
  assert.match(runner,/directory\.generation!==2n/);
  assert.match(runner,/originalMapping\.pii_access_control!==pins\.originalPiiCanister/);
  assert.match(runner,/group2\.canisters\.pii_access_control!==pins\.targetPiiCanister/);
  assert.match(runner,/const first=await readOriginal\(\)/);
  assert.match(runner,/const second=await readOriginal\(\)/);
  assert.match(runner,/const after=await authority\(\)/);
  assert.match(runner,/first\.moduleHash!==second\.moduleHash/);
  assert.match(runner,/before\.directoryFingerprint!==after\.directoryFingerprint/);
});

test('no name/PII reads, writes, releases, upgrades or raw management settings are reported',()=>{
  assert.match(runner,/canister_status:/);
  assert.match(runner,/read_group_opening_configuration:/);
  assert.match(runner,/pii_vetkey_verification_key:/);
  assert.match(runner,/assessOriginalG1PiiAuthority/);
  assert.match(runner,/previousApprovedKeyObservationRun:'43785400907'/);
  assert.match(runner,/noPrivateNamesOrKeysDerived:true/);
  assert.match(runner,/readyToReleaseName:false,nameReadAuthorised:false/);
  assert.doesNotMatch(runner,/\.get_private_profile_names_batch\(|\.get_encrypted_pii_batch\(|\.get_private_profile_name_vetkeys_batch\(|\.read_private_profile_name_authorization\(/);
  assert.doesNotMatch(runner,/\.update_settings\(|\.install_code\(|\.configure_membership_directory\(|\.grant_|\.set_|\.register_pii\(/);
  assert.doesNotMatch(runner,/JSON\.stringify\(status\)|JSON\.stringify\(environment\)|console\.log\(.*(?:environment|status\.settings|publicKey)\)/);
  assert.doesNotMatch(workflow,/icp deploy|icp canister install|git push|update_settings/);
});
