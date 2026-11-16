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

  const release=read('scripts/secure-name-release-policy.mjs');
  assert.ok(!release.includes('IGNITE_DEV_G2_SHARED_CLUB_NAMES_RELEASE'),
    'existing release policy cannot automatically widen club audience');
});

test('DEV original club ciphertext fast path removes only duplicate outer read, never membership or closing key checks',()=>{
  const pii=read('backend/pii_access_control/src/main.mo');
  const rust=read('backend/identity_access/src/lib.rs');
  const helper=pii.slice(pii.indexOf('func devG1SharedClubCiphertextFast('),pii.indexOf('transient let privateNamesIdentity'));
  assert.ok(helper.includes('sharedClubNameEnforcement and devG2SharedClubNames and devG1SharedClubScope(scope)'));
  assert.ok(pii.includes('Principal.fromActor(this).toText() == "iui5p-aaaaa-aaaal-qxllq-cai" and devG2SharedClubScope(scope)'));
  const cipher=pii.slice(pii.indexOf('func get_private_profile_names_batch('),pii.indexOf('func get_private_profile_name_vetkeys_batch('));
  assert.ok(cipher.includes('let first = await authorizePrivateNames(caller, ids, scope)'));
  assert.ok(cipher.includes('if (devG1SharedClubCiphertextFast(scope))'));
  assert.ok(cipher.includes('removalReceiver.denied(caller)'));
  assert.ok(cipher.includes('not canReleasePrivateName(releaseEpoch, scope)'));
  assert.ok(cipher.includes('} else {'));
  assert.ok(cipher.includes('await admitAccount(caller);'));
  assert.ok(cipher.includes('let final = await authorizePrivateNames(caller, ids, scope);'));
  assert.ok(cipher.includes('first != final'));
  assert.ok(cipher.includes('Club-encrypted name copy missing'));
  const shared=pii.slice(pii.indexOf('func get_private_profile_club_name_vetkey('),pii.indexOf('// ==================== Per-club photo key'));
  const derive=shared.indexOf('let key = await ManagementCanister.vetKdDeriveKey(');
  const closing=shared.indexOf('let final = await authorizePrivateNames(caller, ids, scope);');
  assert.ok(derive>=0 && closing>derive);
  assert.ok(shared.includes('let first = await authorizePrivateNames(caller, ids, scope);'));
  assert.ok(shared.includes('first != final'));
  assert.ok(shared.includes('if (not devG1SharedClubCiphertextFast(scope)) await admitAccount(caller)'));
  // Identity remains the service-level trust boundary. A single PII
  // authorization still performs two independently awaited G2 club membership
  // comparisons with fresh account/registry/profile fences.
  const identity=rust.slice(rust.indexOf('async fn read_private_profile_name_authorization('),rust.indexOf('async fn read_guardian_profiles('));
  assert.ok(identity.includes('let viewer = membership_lookup_viewer(viewer_principal)?'));
  assert.ok(identity.includes('read_registry_pages(&config.binding, active).await?'));
  assert.ok(identity.includes('for _ in 0..2'));
  assert.ok(identity.includes('read_profile_membership_batch'));
  assert.ok(identity.includes('club_profiles::verify_batch'));
  assert.ok(identity.includes('retained.as_ref().is_some_and(|prior| prior != &batch)'));
  assert.ok(identity.includes('verify_dev_g1_public_key(service, observed_sha256).await?'));
  assert.ok(identity.includes('active()?'));
});
