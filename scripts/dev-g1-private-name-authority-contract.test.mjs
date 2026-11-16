import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {secureNameChangedSettings, secureNameEnvironment, SAVE_RELEASE, DISPLAY_RELEASE, SHARED_CLUB_NAME_RELEASE, DEV_G2_SHARED_CLUB_RELEASE} from './secure-name-release-policy.mjs';
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

test('Shared DEV G2 club name scope never derives personal display-name keys',()=>{
  const pii=read('backend/pii_access_control/src/main.mo');
  const keyStart=pii.indexOf('public shared ({ caller }) func get_private_profile_name_vetkeys_batch(');
  const keyEnd=pii.indexOf('// ==================== Rehearsal-only club adult-name replicas',keyStart);
  assert.ok(keyStart>0 && keyEnd>keyStart,'individual-key method remains identifiable');
  const individual=pii.slice(keyStart,keyEnd);
  const denied=individual.indexOf('scope.kind == "club" and sharedClubNameEnforcement');
  const derive=individual.indexOf('ManagementCanister.vetKdDeriveKey(');
  assert.ok(denied>=0 && derive>denied,'club audience denied before personal key derivation');
  assert.ok(individual.includes('return #Err("Shared club name audience requires club-key relay")'));
  const names=pii.slice(pii.indexOf('func get_private_profile_names_batch('),keyStart);
  assert.ok(names.includes('sharedClubNameEnforcement or (devG2SharedClubNames and devG2SharedClubScope(scope))'));
  assert.ok(names.includes('let copy = replica ?? return #Err("Club-encrypted name copy missing")'));
  assert.ok(names.includes('copy.master_key_id != clubNameScheme(scope.resource)'));
  const shared=pii.slice(pii.indexOf('func get_private_profile_club_name_vetkey('),pii.indexOf('// ==================== Per-club photo key'));
  assert.ok(shared.includes('scope.kind != "club"'));
  assert.ok(shared.includes('ibeIdentity("clubnames:" # scope.resource, "display_name")'));
  const identity=read('backend/identity_access/src/legacy_g1_private_name.rs');
  assert.ok(identity.includes('scope.kind=="team" || (scope.kind=="club" && approved_shared_club_names && !scope.resource.is_empty() && scope.resource.len()<=128)'));
  assert.ok(identity.includes('scope.authority!=group2_club'));
  assert.ok(pii.includes('scope.kind == "club" and validMediaClub(scope.resource)'));
  assert.ok(pii.includes('IGNITE_SHARED_CLUB_NAME_ENFORCEMENT_RELEASE'));
  assert.ok(pii.includes('not sharedClubNameEnforcement or scope.kind != "team"'));
  assert.ok(pii.includes('scope.kind == "club" and sharedClubNameEnforcement'));
  assert.ok(!identity.includes('scope.kind=="club" && approved_shared_club_names)'));

  // The new universal DEV shared-club release intentionally declares this
  // switch. It must NOT be enabled implicitly by the old authority audit,
  // secure-name saving or the unrelated private-club display release.
  for (const [scope, service] of [
    ['secure_name_save','identity_access'],
    ['secure_name_save','pii_access_control'],
    ['private_club_name_display','identity_access'],
    ['private_club_name_display','pii_access_control'],
  ]) {
    const settings=secureNameChangedSettings(scope,service);
    assert.ok(!settings.includes(DEV_G2_SHARED_CLUB_RELEASE),
      `${scope}/${service} must not automatically widen the G2 club audience`);
    assert.ok(!settings.includes(SHARED_CLUB_NAME_RELEASE),
      `${scope}/${service} must not enable the universal club-name gate`);
  }
  assert.deepEqual(secureNameChangedSettings('shared_club_name_enforcement','identity_access'),
    [DEV_G2_SHARED_CLUB_RELEASE]);
  assert.deepEqual(secureNameChangedSettings('shared_club_name_enforcement','pii_access_control'),
    [SHARED_CLUB_NAME_RELEASE,DEV_G2_SHARED_CLUB_RELEASE]);
  assert.throws(()=>secureNameChangedSettings('shared_club_name_enforcement','club_domain'));

  const dev={identity:'mq2sj-fiaaa-aaaal-qxlqa-cai',originalPii:'iui5p-aaaaa-aaaal-qxllq-cai'};
  const piiEnv=[
    {name:'VETKD_KEY_NAME',value:'key_1'},
    {name:SAVE_RELEASE,value:'1'},
    {name:DISPLAY_RELEASE,value:'1'},
    {name:'IGNITE_SECURE_ADULT_NAME_IDENTITY',value:dev.identity},
    {name:'IGNITE_PRIVATE_PROFILE_IDENTITY',value:dev.identity},
  ];
  assert.throws(()=>secureNameEnvironment(piiEnv,'pii_access_control','shared_club_name_enforcement',
    {identity:'foreign-identity',originalPii:'foreign-pii'}), /DEV-only|mismatch/);
  assert.throws(()=>secureNameEnvironment(piiEnv.filter(r=>r.name!==DISPLAY_RELEASE),
    'pii_access_control','shared_club_name_enforcement',dev), /IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE/);

  // This audit remains a read-only observation, not an activation approval.
  assert.match(runner,/readyToReleaseName:false,nameReadAuthorised:false/);
});
