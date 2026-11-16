/**
 * ORIGINAL IGNITE DEV (public mainnet test canisters) ONLY.
 * Governor-only readback of original G1 PII canister runtime settings and
 * public key, plus matching original G1/G2 Identity directory evidence.
 * No changes, no plaintext names or ciphertext/private vetKeys, no grants.
 *
 * A prior governor-authenticated key read from run 43785400907 is only a
 * SAME-DAY observation; it is not independent historical key provenance.
 */
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Actor,HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { groupApprovalConfiguration } from '../src/live/groupApproval';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE as RouterService } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import type { _SERVICE as IdentityService } from '../src/lab/bindings/identity_access/declarations/identity_access.did';
import { inspectLegacyGroup1TeamNameTopology } from '../src/live/crossGroupTeamNameReadiness';
import { readerRouterAuthorityFingerprint } from '../../scripts/dev-generation2-reader-router-authority.mjs';
import { assessOriginalG1PiiAuthority } from '../../scripts/dev-g1-private-name-authority-policy.mjs';
import { GROUP2_GOVERNOR } from '../../scripts/group2-upgrade-rules.mjs';

const [pemPath,reportDir] = process.argv.slice(2);
if (!pemPath || !reportDir ||
    process.env.GITHUB_REPOSITORY?.toLowerCase() !== 'ignite-club-hq/ignite-club_hq-prod' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.DEV_G1_PII_AUTHORITY_ACTION !== 'check' ||
    process.env.DEV_G1_PII_AUTHORITY_CONFIRMATION !== 'AUDIT DEV ORIGINAL G1 PII AUTHORITY READ ONLY') {
  throw new Error('Only exact original DEV main-branch owner-approved read-only audit allowed');
}
const root = new URL('../../', import.meta.url);
const originalMapping = JSON.parse(readFileSync(new URL('deploy/mainnet/.icp/data/mappings/ic.ids.json',root),'utf8'));
const group2 = JSON.parse(readFileSync(new URL('deploy/groups/g2/provision.json',root),'utf8'));
const pins = Object.freeze({
  originalClubDomain:'mzzzv-taaaa-aaaal-qxlrq-cai',
  originalPiiCanister:'iui5p-aaaaa-aaaal-qxllq-cai',
  targetClubDomain:'yfwyv-nyaaa-aaaal-qxpyq-cai',
  targetPiiCanister:'zt5a6-yiaaa-aaaal-qxp5q-cai',
  sourceGroupId:'g1',targetGroupId:'g2',
  routerCanister:'jcdfe-vqaaa-aaaal-qxloq-cai',
  identityAccess:'mq2sj-fiaaa-aaaal-qxlqa-cai',
});
if (originalMapping.shard_router!==pins.routerCanister ||
    originalMapping.identity_access!==pins.identityAccess ||
    originalMapping.club_domain!==pins.originalClubDomain ||
    originalMapping.pii_access_control!==pins.originalPiiCanister ||
    group2.canisters.club_domain!==pins.targetClubDomain ||
    group2.canisters.pii_access_control!==pins.targetPiiCanister) {
  throw new Error('Exact source-controlled original DEV/G2 inventory required; no changes made');
}
const previousGovernorObservedKeySha256='f80ed20bc0d8a244f40b31fdbd0024ff469d24254197dce9242dce669fa1f34d';
const operator=loadOperatorIdentity(pemPath);
const governor=operator.getPrincipal().toText();
if(governor!==GROUP2_GOVERNOR)throw new Error('Exact original DEV governor required; no changes made');
const agent=await HttpAgent.create({host:'https://icp-api.io',identity:operator});
const router=Actor.createActor<RouterService>(routerIdl,{agent,canisterId:pins.routerCanister});
const identity=Actor.createActor<IdentityService>(identityIdl,{agent,canisterId:pins.identityAccess});
const piiId=Principal.fromText(pins.originalPiiCanister);

// The controller-readable management service reports transient environment
// variables. Never serialize, upload, log, or expose their raw values.
const mgmtIdl=()=>IDL.Service({
  canister_status:IDL.Func([IDL.Record({canister_id:IDL.Principal})],
    [IDL.Record({module_hash:IDL.Opt(IDL.Vec(IDL.Nat8)),
      settings:IDL.Record({controllers:IDL.Vec(IDL.Principal),
        environment_variables:IDL.Vec(IDL.Record({name:IDL.Text,value:IDL.Text}))})})],[]),
});
type PiiStatus={module_hash:[]|[Uint8Array];settings:{
  controllers:Principal[];environment_variables:Array<{name:string,value:string}>}};
const mgmt=Actor.createActor(mgmtIdl,{agent,canisterId:'aaaaa-aa',effectiveCanisterId:piiId} as Parameters<typeof Actor.createActor>[1]) as unknown as {
  canister_status(a:{canister_id:Principal}):Promise<PiiStatus>
};
const publicIdl=()=>IDL.Service({
  pii_vetkey_verification_key:IDL.Func([],[IDL.Vec(IDL.Nat8)],[]),
  read_group_opening_configuration:IDL.Func([],[IDL.Vec(IDL.Tuple(IDL.Text,IDL.Text))],[]),
});
const pii=Actor.createActor(publicIdl,{agent,canisterId:pins.originalPiiCanister}) as unknown as {
  pii_vetkey_verification_key():Promise<Uint8Array>,
  read_group_opening_configuration():Promise<Array<[string,string]>>,
};

const registry=()=>readPinnedGroupRegistry((rev,cursor,limit)=>
  router.read_group_registry_page('mainnet',rev,cursor,limit));
const readDirectory=async()=>{
  const result=await identity.read_membership_directory_configuration();
  if('Err' in result) throw new Error('Governor directory read refused; no changes made');
  return result.Ok;
};
const authority=async()=>{
  const snapshot=await registry();
  if(snapshot.revision!==11n)throw new Error('Router revision differs from pinned DEV revision 11');
  const target=snapshot.placements.find(p=>p.group_id==='g2');
  if(!target)throw new Error('Original DEV registered Group 2 placement absent');
  const binding={
    targetAlias:'main',registryAlias:'mainnet',
    deploymentId:target.deployment_id,deploymentRevision:target.deployment_revision,
    host:target.host,networkKind:target.network_kind,registryRevision:snapshot.revision,
    requiredClubAuthorities:[pins.targetClubDomain]
  };
  const directory=await readDirectory();
  inspectLegacyGroup1TeamNameTopology(snapshot,binding,directory,pins);
  if(directory.generation!==2n)throw new Error('Exact previously released DEV generation-2 directory required');
  const routerFingerprint=readerRouterAuthorityFingerprint(
    snapshot,groupApprovalConfiguration(snapshot.groups,snapshot.placements));
  const directoryFingerprint=JSON.stringify({
    binding:directory.binding,generation:directory.generation,
    enabled:directory.enabled,app_enabled:directory.app_enabled,
    inventory_digest:directory.inventory_digest,sources:directory.sources,
  },(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?Array.from(v):v);
  return {routerFingerprint,directoryFingerprint};
};
const before=await authority();

const readOriginal=async()=>{
  // These are the only original-PII calls; do not add profile/ciphertext,
  // vetKey-derivation or guardian/role reads to a topology audit.
  const status=await mgmt.canister_status({canister_id:piiId});
  if(status.module_hash.length!==1 || status.module_hash[0].length!==32)
    throw new Error('Original DEV PII module hash unavailable; no settings can be trusted');
  const opening=await pii.read_group_opening_configuration();
  const publicKey=Uint8Array.from(await pii.pii_vetkey_verification_key());
  if(publicKey.length!==96)throw new Error('Original DEV PII public key has unexpected format');
  const results=assessOriginalG1PiiAuthority({
    expected:{identity:pins.identityAccess,originalClub:pins.originalClubDomain,
      originalPii:pins.originalPiiCanister},
    governor,
    controllers:status.settings.controllers.map(p=>p.toText()),
    environment:status.settings.environment_variables,
    opening,
    publicKeySha256:createHash('sha256').update(publicKey).digest('hex'),
    previousReadSha256:previousGovernorObservedKeySha256,
  });
  return {moduleHash:Buffer.from(status.module_hash[0]).toString('hex'),results};
};
const first=await readOriginal();
const second=await readOriginal();
if(first.moduleHash!==second.moduleHash ||
   JSON.stringify(first.results)!==JSON.stringify(second.results))
  throw new Error('Original DEV PII settings, key or controller status changed during the read-only audit');
const after=await authority();
if(before.routerFingerprint!==after.routerFingerprint ||
   before.directoryFingerprint!==after.directoryFingerprint)
  throw new Error('Router or membership-directory security authority changed during the audit');

mkdirSync(resolve(reportDir),{recursive:true});
const outcome={
  action:'check',status:'read-only-audit-completed-name-release-blocked',
  environment:'ignite-dev-mainnet',routerRevision:'11',directoryGeneration:'2',
  previousApprovedKeyObservationRun:'43785400907',
  ...first.results,
  immutableModuleAcrossReadbacks:true,
  stableSourceAuthorityAcrossReadbacks:true,
  noCanisterChanges:true,
  noPrivateNamesOrKeysDerived:true,
  noProdOrSupabaseAccess:true,
  // This audit deliberately does not attest the original historical
  // deployment/key baseline, Identity legacy-PII allowlist, or per-team ACL.
  readyToReleaseName:false,nameReadAuthorised:false,
};
writeFileSync(resolve(reportDir,'check.json'),JSON.stringify(outcome,null,2));
console.log('Read-only G1 PII authority audit complete. Original historical key proof and team-only name permission remain NOT RELEASED.');
if(!first.results.previouslyObservedKeyMatches)
  throw new Error('Original G1 PII public key differs from prior authenticated same-day observation; name release stays blocked');
