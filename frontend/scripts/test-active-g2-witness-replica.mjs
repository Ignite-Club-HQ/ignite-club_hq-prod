// Isolated real-Wasm identity + independent witness checks, never live ICP.
// Positive witness receipt uses PocketIC's chosen *sender principal*; that is
// NOT proof of a real identity-to-witness inter-canister call. Identity reader
// remains hard-disabled. No DEV deployment, grant, or release implied.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PocketIc } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory as identityFactory } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as clubFactory } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as witnessFactory } from '../src/lab/bindings/recovery_witness/declarations/recovery_witness.did.js';
import { startRemovalLocalServer, finishRemovalLocalTest } from './removal-local-supervisor.mjs';
import { removalHostPreflight } from './removal-host-preflight.mjs';
import { allowLongUpdates } from './pocket-ic-long-updates.mjs';
import { createLocalLifecycleReader } from './removal-local-lifecycle.mjs';
import { assertCandidEqual } from './assert-candid-equal.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const report={kind:'dev-g2-independent-subject-witness-isolated',passed:false,
  releaseAuthorized:false,liveDeployment:false,realIdentityToWitnessCall:false,checks:[]};
const p=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const owner=p(1),member=p(2),outsider=p(3),alias=p(4);
const identityPin=Principal.fromText('mq2sj-fiaaa-aaaal-qxlqa-cai');
const clubPin=Principal.fromText('yfwyv-nyaaa-aaaal-qxpyq-cai');
const routerPin=Principal.fromText('jcdfe-vqaaa-aaaal-qxloq-cai');
const ok=r=>{assert.ok(r && 'Ok' in r,String(r?.Err));return r.Ok;};
const rejects=(r,pattern)=>{assert.ok(r && 'Err' in r,'Expected fail-closed Result.Err');if(pattern)assert.match(r.Err,pattern);};
const dig=n=>new Uint8Array(32).fill(n);
const pub=k=>k.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
const mark=name=>report.checks.push(name);
let pic,server,primaryError,stage='host preflight';
try {
  if(!process.env.G2_WITNESS_ISOLATED_REPORT)throw Error('Evidence report path required');
  report.host=removalHostPreflight();
  server=await startRemovalLocalServer({binary:process.env.POCKET_IC_BIN,hardTtlSeconds:900});
  pic=await PocketIc.create(server.url,{processingTimeoutMs:90000});allowLongUpdates(pic);
  // Disposable identities and freshly generated keys never leave this process.
  const recoveryKey=generateKeyPairSync('ed25519'),accountKey=generateKeyPairSync('ed25519');
  const witnessId=await pic.createCanister({sender:owner,controllers:[owner]});
  const target=path.join(root,'target/isolated-g2-witness');
  stage='build actual identity and witness WASM using ephemeral public-key pins';
  const build=(name,vars,fixture=false)=>execFileSync('cargo',['build','--locked','--release','--target','wasm32-unknown-unknown','-p',name,...(fixture?['--features','isolated-g2-chain-fixture']:[])],{
    cwd:root,timeout:360000,stdio:['ignore','ignore','pipe'],
    env:{...process.env,CARGO_TARGET_DIR:target,...vars}});
  build('recovery_witness',{IGNITE_RECOVERY_APPROVER_PUBLIC_KEY:pub(recoveryKey)});
  const witnessWasm=path.join(target,'wasm32-unknown-unknown/release/recovery_witness.wasm');
  const witnessHash=createHash('sha256').update(readFileSync(witnessWasm)).digest('hex');
  build('identity_access',{
    IGNITE_RECOVERY_APPROVER_PUBLIC_KEY:pub(recoveryKey),
    IGNITE_PRODUCTION_ACCOUNT_WITNESS:witnessId.toText(),
    IGNITE_PRODUCTION_ACCOUNT_WITNESS_MODULE_HASH:witnessHash,
    IGNITE_PRODUCTION_ACCOUNT_WITNESS_CONTROLLER:owner.toText(),
    IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY:pub(accountKey),
    IGNITE_ISOLATED_G2_FIXTURE_BUILD:'POCKETIC_ONLY_NOT_DEPLOYABLE',
  },true);
  const identityWasm=path.join(target,'wasm32-unknown-unknown/release/identity_access.wasm');
  report.identityWasmSha256=createHash('sha256').update(readFileSync(identityWasm)).digest('hex');
  report.witnessWasmSha256=witnessHash;
  stage='install disposable real canisters at exact identity pin';
  const initIdentity=IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor:owner}]);
  const identity=await pic.setupCanister({targetCanisterId:identityPin,idlFactory:identityFactory,wasm:identityWasm,
    sender:owner,controllers:[owner],arg:initIdentity});
  assert.equal(identity.canisterId.toText(),identityPin.toText());
  await pic.installCode({canisterId:witnessId,sender:owner,wasm:witnessWasm,
    arg:IDL.encode([IDL.Record({governor:IDL.Principal,identity:IDL.Principal})],[{governor:owner,identity:identityPin}])});
  const w=pic.createActor(witnessFactory,witnessId),id=identity.actor;
  w.setPrincipal(owner);id.setPrincipal(member);
  const account=ok(await id.register_account());
  assert.equal(account.version,0n,'Fresh Ignite account must be accepted at version zero');
  id.setPrincipal(alias);
  const erasedAccount=ok(await id.register_account());
  assert.equal(erasedAccount.version,0n,'Erasure scenario starts as a legitimate new account');
  id.setPrincipal(owner);
  const participant=await pic.createCanister({sender:owner,controllers:[owner]});
  await pic.installCode({canisterId:participant,sender:owner,wasm:identityWasm,arg:initIdentity});
  const lifecycle=await createLocalLifecycleReader(pic,owner);
  const version=ok(await w.read_recovery_runtime_version());
  const identityVersion=ok(await id.read_production_account_runtime_version());
  const nowMs=BigInt(await pic.getTime());
  const head=ok(await w.read_recovery_head());
  const body={witness:witnessId,witness_version:version,identity:identityPin,
    epoch:head.epoch,journal_revision:head.revision,journal_digest:head.digest,
    inventory_digest:dig(1),decoded_history_digest:dig(2),generation:1n,signed_digest:dig(3),
    expires_at_ns:(nowMs+120000n)*1000000n,history_revision:0n,removal_generation:0n,
    identity_version:identityVersion,participants:[await lifecycle(identityPin),await lifecycle(participant)]};
  const signature=async method=>new Uint8Array(sign(null,Buffer.from(ok(await w[method](body))),recoveryKey.privateKey));
  stage='independent globally and subject signed baseline';
  const accepted={body,signature:await signature('recovery_acceptance_signing_bytes')};
  ok(await w.accept_recovery_fence(accepted));
  const subjectSigned={body,signature:await signature('subject_progress_approval_signing_bytes')};
  ok(await w.authorize_subject_removal_progress(subjectSigned));
  const baselineDigest=ok(await w.read_active_g2_baseline_digest());
  assert.equal(baselineDigest.length,32);
  mark('Independent recovery and subject progress baseline signed and armed with real WASM');
  stage='sign exact DEV G2 scope and commission witness only';
  const scope={identity:identityPin,router:routerPin,club_reader:clubPin,witness:witnessId,
    registry_revision:8n,generation:1n,recovery_epoch:head.epoch,
    expires_at_ns:(nowMs+60000n)*1000000n,accepted_recovery_digest:baselineDigest};
  const signed={scope,signature:new Uint8Array(sign(null,Buffer.from(ok(await w.active_g2_scope_signing_bytes(scope))),recoveryKey.privateKey))};
  const wrong={scope,signature:new Uint8Array(64)};
  rejects(await w.authorize_active_g2_subject_reader(wrong),/signature/i);
  w.setPrincipal(outsider);
  rejects(await w.authorize_active_g2_subject_reader(signed),/governor/i);
  w.setPrincipal(owner);
  ok(await w.authorize_active_g2_subject_reader(signed));
  rejects(await w.authorize_active_g2_subject_reader(signed),/generation/i);
  mark('Independent G2 authorisation requires signed scope, governor and monotonic generation');
  stage='real Club G2 sender -> signed-in identity -> independent witness';
  // Only this isolated, feature-gated identity WASM exposes the fixture setter.
  // Its actual read_linked_account method calls the same independent-witness
  // validation logic as the proposed production reader, but skips active
  // router/receiver commissioning. This is NOT a production acceptance.
  const fixtureActorMethod=IDL.Func([IDL.Record({
    scope:IDL.Record({
      identity:IDL.Principal,router:IDL.Principal,club_reader:IDL.Principal,
      witness:IDL.Principal,registry_revision:IDL.Nat64,generation:IDL.Nat64,
      recovery_epoch:IDL.Nat64,expires_at_ns:IDL.Nat64,accepted_recovery_digest:IDL.Vec(IDL.Nat8),
    }),signature:IDL.Vec(IDL.Nat8),
  })],[IDL.Variant({Ok:IDL.Null,Err:IDL.Text})],[]);
  const [fixtureApproval]=IDL.decode(fixtureActorMethod.retTypes,
    await pic.updateCall({canisterId:identityPin,sender:owner,
      method:'fixture_g2_authorize_reader',arg:IDL.encode(fixtureActorMethod.argTypes,[signed])}));
  ok(fixtureApproval);
  const clubWasm=process.env.G2_ACTUAL_CLUB_DOMAIN_WASM;
  assert.ok(clubWasm,'Compiled real club_domain WASM required; no surrogate club probe');
  const club=await pic.setupCanister({
    targetCanisterId:clubPin,idlFactory:clubFactory,wasm:clubWasm,
    sender:owner,controllers:[owner],arg:IDL.encode([IDL.Principal],[owner]),
    environmentVariables:[{name:'IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE',value:'1'}],
  });
  assert.equal(club.canisterId.toText(),clubPin.toText());
  club.actor.setPrincipal(owner);
  // Genuine club code: use its narrowly guarded, set-once existing identity
  // authority binding. No local account rehearsal or removal flags are set.
  ok(await club.actor.link_display_identity_authority(identityPin));
  const localClub='g2-isolated-club';
  ok(await club.actor.create_club(localClub,'G2 Isolated Test Club','g2-isolated-test-club',[],[]));
  ok(await club.actor.add_role_grant(member,localClub,'player',[]));
  club.actor.setPrincipal(member);
  const before=await club.actor.read_account_whoami();
  rejects(before,/Unlinked identity/i);
  ok(await club.actor.sync_my_linked_account());
  const linked=ok(await club.actor.read_account_whoami());
  assert.equal(linked.id,account.id);
  assert.equal(linked.version,0n);
  assert.deepEqual(linked.principals.map(p=>p.toText()),account.principals.map(p=>p.toText()));
  const membership=ok(await club.actor.read_my_club_memberships_indexed([],100));
  assert.ok(membership.clubs.includes(localClub),'Actual club membership must survive sync');
  club.actor.setPrincipal(outsider);
  rejects(await club.actor.sync_my_linked_account(),/Account|Unlinked|identity|registered|unavailable|not found/i);
  mark('Real Club Domain sync_my_linked_account -> identity -> independent witness links version-zero new user, preserves membership and denies outsider');

  stage='suspended account must not sync even while original local membership remains';
  id.setPrincipal(owner);
  ok(await id.set_account_status(account.id,{Suspended:null}));
  club.actor.setPrincipal(member);
  rejects(await club.actor.sync_my_linked_account(),/Account suspended|Account|identity/i);
  id.setPrincipal(owner);
  ok(await id.set_account_status(account.id,{Active:null}));
  club.actor.setPrincipal(member);
  ok(await club.actor.sync_my_linked_account());
  assert.equal(ok(await club.actor.read_account_whoami()).id,account.id);
  mark('Real Club Domain denies a suspended account and correctly relinks on reviewed reactivation');

  stage='suspended account must reject held in-flight Club Domain sync';
  // Use the same submit/await pattern as the existing account-group race
  // fixture. A stopped witness keeps the identity's update unresolved; a
  // concurrent status change MUST never yield an authorised stale link.
  await pic.stopCanister({canisterId:witnessId,sender:owner});
  const signature=clubFactory({IDL})._fields.find(([name])=>name==='sync_my_linked_account')?.[1];
  assert.ok(signature,'Real Club Domain sync_my_linked_account signature required');
  const pending=await pic.client.submitCall({canisterId:clubPin,sender:member,
    method:'sync_my_linked_account',payload:new Uint8Array(IDL.encode(signature.argTypes,[]))});
  await pic.tick(1);
  id.setPrincipal(owner);
  ok(await id.set_account_status(account.id,{Suspended:null}));
  await pic.startCanister({canisterId:witnessId,sender:owner});
  const race=IDL.decode(signature.retTypes,(await pic.client.awaitCall(pending)).body)[0];
  rejects(race);
  id.setPrincipal(owner);
  ok(await id.set_account_status(account.id,{Active:null}));
  club.actor.setPrincipal(member);
  ok(await club.actor.sync_my_linked_account());
  mark('Held Club Domain update cannot complete a stale account link after concurrent suspension');


  const scopeDigest=new Uint8Array(createHash('sha256').update(ok(await w.active_g2_scope_signing_bytes(scope))).digest());
  // The true three-canister call will use identity's fresh request sequence 1.
  // Reserve the simulated sender-only witness tests for distinct nonce 100.
  const q={scope_digest:scopeDigest,nonce:100n,account_id:account.id,
    account_version:account.version,principals:account.principals,subject:member,
    history_revision:0n,removal_generation:0n,recovery_epoch:scope.recovery_epoch};
  const request={approval:signed,challenge:q};
  stage='exact witness identity caller and subject challenge';
  w.setPrincipal(outsider);
  rejects(await w.verify_active_g2_subject_read_fence(request),/Pinned identity/i);
  w.setPrincipal(identityPin);
  const valid=ok(await w.verify_active_g2_subject_read_fence(request));
  assertCandidEqual(valid.challenge,q);
  assert.ok(valid.witness_revision>0n);
  rejects(await w.verify_active_g2_subject_read_fence(request),/Replayed/i);
  mark('Real witness accepts fresh active subject request only from pinned identity sender and rejects replay');
  let nextNonce=10n;
  for(const [name,mutate] of [
    ['wrong subject',x=>({...x,subject:outsider})],
    ['invalid alias set',x=>({...x,principals:[member,member]})],
    ['invalid scope digest',x=>({...x,scope_digest:dig(4)})],
    ['zero nonce',x=>({...x,nonce:0n})],
  ]) {
    const altered=mutate({...q,nonce:nextNonce++});
    const result=await w.verify_active_g2_subject_read_fence({...request,challenge:altered});
    rejects(result);
    assert.doesNotMatch(result.Err,/Replayed/,name+' must fail its own security check, not the replay guard');
  }
  // The independent witness cannot know the account ID is current without
  // identity_access. Only that service checks current_service_account on both
  // sides of the awaited witness call; no unsupported wrong-account claim here.
  mark('Invalid subject membership, aliases, scope digest and nonce rejected');
  stage='independently recorded removal closes witness and protects subject';
  w.setPrincipal(owner);
  const removal={operation_id:'g2/removal',event:{Removal:{
    account_id:account.id,generation:1n,inventory_digest:dig(5),
    subjects:[member],targets:[identityPin,participant]}}};
  ok(await w.record_removal_recovery(removal));
  // The same genuine G2 club caller must now fail the whole chain, even
  // though the local account has not yet been deleted in the identity fixture.
  club.actor.setPrincipal(member);
  const revokedChain=await club.actor.sync_my_linked_account();
  rejects(revokedChain);
  mark('Actual Club Domain re-sync fails closed after independently recorded removal');
  // The browser cannot impersonate the G2 service, even for its own account.
  id.setPrincipal(member);
  rejects(await id.read_linked_account(member),/Exact Group 2 club canister caller required/i);
  id.setPrincipal(owner);
  mark('Direct browser-to-identity linked account read cannot bypass exact club sender');
  w.setPrincipal(identityPin);
  rejects(await w.verify_active_g2_subject_read_fence({...request,challenge:{...q,nonce:50n}}));
  mark('Actual independent removal journal prevents later G2 account reads');
  stage='upgrade disarms reader capability';
  await pic.upgradeCanister({canisterId:witnessId,sender:owner,wasm:witnessWasm,arg:IDL.encode([],[])});
  rejects(await w.verify_active_g2_subject_read_fence({...request,challenge:{...q,nonce:51n}}));
  mark('Witness upgrade cannot restore prior signed reader authorisation');
  stage='erased account must lose identity-backed re-sync without a witness removal record';
  club.actor.setPrincipal(alias);
  ok(await club.actor.sync_my_linked_account());
  assert.equal(ok(await club.actor.read_account_whoami()).id,erasedAccount.id);
  id.setPrincipal(alias);
  ok(await id.erase_account(erasedAccount.id));
  rejects(await id.register_account(),/Erased|denied|not allowed|blocked|revoked|removed/i);
  club.actor.setPrincipal(alias);
  rejects(await club.actor.sync_my_linked_account(),/Account|Unknown|Erased|unavailable|revoked/i);
  mark('Real Club Domain rejects erased account independently of witness-side removal');
  report.passed=true;
} catch(error) {
  if(error.hostReport)report.host=error.hostReport;
  primaryError=error;
} finally {
  report.stage=stage;
  await finishRemovalLocalTest({pic,server,report,primaryError,writeReport:async()=>{
    if(process.env.G2_WITNESS_ISOLATED_REPORT){
      mkdirSync(path.dirname(process.env.G2_WITNESS_ISOLATED_REPORT),{recursive:true});
      writeFileSync(process.env.G2_WITNESS_ISOLATED_REPORT,JSON.stringify(report,null,2)+'\n');
    }
  }});
}
