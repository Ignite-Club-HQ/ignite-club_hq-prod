/**
 * Original Ignite DEV (public mainnet test canisters) only: inspect or
 * separately owner-approved fill of the already configured generation-2
 * membership directory. It never installs Wasm, reconfigures sources,
 * modifies accounts/children/PII, or enables the membership lookup reader.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Principal } from '@icp-sdk/core/principal';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { groupApprovalConfiguration } from '../src/live/groupApproval';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE as RouterService } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import type { _SERVICE as IdentityService } from '../src/lab/bindings/identity_access/declarations/identity_access.did';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import type { _SERVICE as ClubService } from '../src/lab/bindings/club_domain/declarations/club_domain.did';
import { runFill } from '../../scripts/membership-lookup-release-policy.mjs';
import { runOwnershipAcceptance } from '../../scripts/membership-ownership-acceptance.mjs';
import { checkReplicaAcceptance, requireCompleteFill } from '../../scripts/membership-acceptance-checks.mjs';
import { fingerprint } from '../../scripts/membership-source-configuration.mjs';
import { GROUP2_GOVERNOR } from '../../scripts/group2-upgrade-rules.mjs';

const [pem, reportDir] = process.argv.slice(2);
const action = process.env.DEV_DIRECTORY_GEN2_ACTION;
const confirmation = process.env.DEV_DIRECTORY_GEN2_CONFIRMATION;
const phrase = 'FILL IGNITE DEV MEMBERSHIP DIRECTORY GENERATION 2';
if (!pem || !reportDir ||
    process.env.GITHUB_REPOSITORY?.toLowerCase() !== 'ignite-club-hq/ignite-club_hq-prod' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    !['check','fill'].includes(action ?? '') ||
    (action === 'fill' && confirmation !== phrase) ||
    (action === 'check' && confirmation)) {
  throw new Error('Exact protected DEV check/fill request, main branch and confirmation required');
}
const P = Object.freeze({
  router:'jcdfe-vqaaa-aaaal-qxloq-cai',
  identity:'mq2sj-fiaaa-aaaal-qxlqa-cai',
  g1:'mzzzv-taaaa-aaaal-qxlrq-cai',
  g2:'yfwyv-nyaaa-aaaal-qxpyq-cai',
  g2Pii:'zt5a6-yiaaa-aaaal-qxp5q-cai',
});
const governor=loadOperatorIdentity(pem);
if (governor.getPrincipal().toText()!==GROUP2_GOVERNOR) {
  throw new Error('Exact original DEV governor required');
}
const agent=await HttpAgent.create({host:'https://icp-api.io',identity:governor});
const router=Actor.createActor<RouterService>(routerIdl,{agent,canisterId:P.router});
const identity=Actor.createActor<IdentityService>(identityIdl,{agent,canisterId:P.identity});
const sources=[
  { groupId:'g1', canisterId:P.g1 },
  { groupId:'g2', canisterId:P.g2 },
].map(s=>({...s,actor:Actor.createActor<ClubService>(clubIdl,{agent,canisterId:s.canisterId})}));
const unwrap=<T>(reply:{Ok:T}|{Err:string},label:string):T=>{
  if('Err' in reply)throw new Error(label+' refused: '+reply.Err);
  return reply.Ok;
};
const readRegistry=()=>readPinnedGroupRegistry((rev,cursor,limit)=>
  router.read_group_registry_page('mainnet',rev,cursor,limit));
const verifyRegistry=async()=>{
  const snapshot=await readRegistry();
  if(snapshot.revision!==11n || snapshot.groups.length!==1 ||
      snapshot.placements.length!==1 || snapshot.groups[0].id!=='g2' ||
      snapshot.placements[0].group_id!=='g2' ||
      snapshot.groups[0].domains.find(d=>d.domain==='club_domain')?.canister.toText()!==P.g2 ||
      snapshot.groups[0].domains.find(d=>d.domain==='pii_access_control')?.canister.toText()!==P.g2Pii ||
      snapshot.placements[0].deployment_id!=='mainnet' ||
      snapshot.placements[0].host!=='https://icp-api.io' ||
      snapshot.placements[0].network_kind!=='public_mainnet' ||
      snapshot.placements[0].deployment_revision!==1n) {
    throw new Error('Exact DEV router revision 11 and registered G2 inventory required');
  }
  return snapshot;
};
const verifyConfig=async()=>{
  const c=unwrap(await identity.read_membership_directory_configuration(),'DEV directory');
  const expected=[['g1',P.g1],['g2',P.g2]];
  if(!c.enabled || c.app_enabled || c.generation!==2n ||
      c.binding.registry.toText()!==P.router || c.binding.registry_revision!==11n ||
      c.binding.target_alias!=='mainnet' || c.binding.deployment_id!=='mainnet' ||
      c.binding.deployment_revision!==1n || c.binding.host!=='https://icp-api.io' ||
      c.binding.network_kind!=='public_mainnet' || c.inventory_digest.length!==32 ||
      fingerprint(c.sources.map(([g,p])=>[g,p.toText()]))!==fingerprint(expected)) {
    throw new Error('Existing unreleased DEV directory generation 2 is not exactly pinned');
  }
  return c;
};
const initialRegistry=await verifyRegistry();
const registryConfig=groupApprovalConfiguration(initialRegistry.groups,initialRegistry.placements);
const initial=await verifyConfig();
const initialFingerprint=fingerprint(initial);
const gate=async()=>{
  const now=await verifyRegistry();
  if(now.configurationRevision!==initialRegistry.configurationRevision ||
      groupApprovalConfiguration(now.groups,now.placements)!==registryConfig) {
    throw new Error('DEV router authority changed during staging');
  }
  if(fingerprint(await verifyConfig())!==initialFingerprint) {
    throw new Error('DEV directory authority or release state changed during staging');
  }
};
const verifySources=async()=>{
  const observed=[];
  for(const s of sources){
    const current=unwrap(await s.actor.read_membership_directory_source_binding(),s.groupId+' source binding');
    const grant=current.binding[0];
    if(!current.enabled || current.binding.length!==1 || !grant ||
        grant.identity.toText()!==P.identity || grant.router.toText()!==P.router ||
        grant.group!==s.groupId || grant.deployment!=='mainnet' ||
        grant.generation!==2n || fingerprint(grant.inventory_digest)!==fingerprint(initial.inventory_digest)) {
      throw new Error('Existing '+s.groupId+' generation-2 source binding changed');
    }
    const status=unwrap(await s.actor.read_membership_discovery_status(),s.groupId+' source status');
    if(status.revision<1n || status.acknowledged<0n || status.acknowledged>status.revision ||
        typeof status.pending!=='boolean') {
      throw new Error('Invalid '+s.groupId+' directory source status');
    }
    observed.push({groupId:s.groupId,revision:status.revision,acknowledged:status.acknowledged,pending:status.pending});
  }
  await gate();
  return observed;
};
const writeReport=(data:Record<string,unknown>)=>{
  mkdirSync(resolve(reportDir),{recursive:true});
  writeFileSync(resolve(reportDir,'check.json'),JSON.stringify({
    action,target:'exact-existing-DEV-identity',routerRevision:'11',
    directoryGeneration:'2',groups:['g1','g2'],readerReleased:false,
    noCanisterUpgrades:true,noSourceReconfiguration:true,
    noPrivateNamesOrPermissions:true,noProdOrSupabaseAccess:true,
    ...data,
  },null,2));
};
const before=await verifySources();
if(action==='check'){
  writeReport({state:'checked-closed',readOnly:true,
    sources:before.map(s=>({group:s.groupId,revision:String(s.revision),
      acknowledged:String(s.acknowledged),pending:s.pending})),
    readyForReaderRelease:false});
  console.log('Exact DEV generation-2 sources checked; reader closed. No changes made.');
  process.exit(0);
}
// Explicitly approved, bounded work on the current disposable DEV directory
// index only. No configure, install, permissions or reader-release operation.
const completed:Record<string,bigint>={};
const fill=await runFill(sources.map(s=>s.groupId),async groupId=>{
  await gate();
  const reply=await identity.advance_membership_directory_source(groupId);
  await gate();
  return reply;
},{maxCalls:512,retries:2,persist:async(groupId,revision)=>{
  completed[groupId]=revision;
  writeReport({state:'fill-in-progress',readOnly:false,
    acknowledgedRevisions:Object.fromEntries(Object.entries(completed).map(([id,r])=>[id,String(r)])),
    readyForReaderRelease:false});
}});
requireCompleteFill(sources,fill);
const after=await verifySources();
for(const s of after) {
  if(s.pending || s.revision!==fill[s.groupId] || s.acknowledged!==s.revision)
    throw new Error('Source revisions changed after generation-2 fill');
}
const owner=await runOwnershipAcceptance(
  ()=>identity.advance_membership_directory_ownership(),
  {sources:sources.map(s=>({groupId:s.groupId,authority:Principal.fromText(s.canisterId)})),
   completed:fill,inventoryDigest:initial.inventory_digest},
  {maxCalls:512,gate,persist:async p=>writeReport({
    state:'ownership-in-progress',readOnly:false,
    ownershipComplete:p.complete,readyForReaderRelease:false,
  })},
);
if(!owner.complete || owner.verified_current!==false)throw new Error('DEV directory ownership not complete');
const accepted=await checkReplicaAcceptance(sources,fill,{
  gate,check:()=>identity.check_membership_directory_acceptance(),
});
await verifySources();
await gate();
writeReport({state:'filled-and-verified-closed',readOnly:false,
  acknowledgedRevisions:Object.fromEntries(Object.entries(fill).map(([id,r])=>[id,String(r)])),
  snapshotVerified:accepted.snapshotVerified,
  restorationGuardVerified:accepted.restorationGuardVerified,
  readerReleased:false,readyForReaderRelease:false});
console.log('DEV generation-2 directory fill and ownership verified; reader remains CLOSED. No Wasm upgrades, PII or Supabase changes.');
