/**
 * Exact original DEV-only generation-2 membership reader release.
 * Check is strictly read-only; release requires a matching checked-plan hash
 * and a separate protected, human-reviewed confirmation.
 * This script never installs code, changes sources/PII or publishes an app.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { fingerprint } from '../../scripts/membership-source-configuration.mjs';
import { GROUP2_GOVERNOR } from '../../scripts/group2-upgrade-rules.mjs';
import { readerRouterAuthorityFingerprint } from '../../scripts/dev-generation2-reader-router-authority.mjs';

const [pemPath,reportDirectory] = process.argv.slice(2);
const action=process.env.DEV_GEN2_RELEASE_ACTION;
const confirmation=process.env.DEV_GEN2_RELEASE_CONFIRMATION ?? '';
const checkedPlan=(process.env.DEV_GEN2_CHECKED_PLAN ?? '').trim();
const commit=process.env.GITHUB_SHA ?? '';
const exactPhrase='RELEASE IGNITE DEV MEMBERSHIP LOOKUP GENERATION 2';
if (!pemPath || !reportDirectory ||
    process.env.GITHUB_REPOSITORY?.toLowerCase()!=='ignite-club-hq/ignite-club_hq-prod' ||
    process.env.GITHUB_REF!=='refs/heads/main' ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    !['check','release'].includes(action ?? '') ||
    (action==='check' && (confirmation!=='' || checkedPlan!=='')) ||
    (action==='release' && (confirmation!==exactPhrase || !/^[a-f0-9]{64}$/.test(checkedPlan)))) {
  throw new Error('Only protected exact DEV generation-2 check or approved plan-pinned release allowed');
}
const P=Object.freeze({
  identity:'mq2sj-fiaaa-aaaal-qxlqa-cai',
  router:'jcdfe-vqaaa-aaaal-qxloq-cai',
  g1:'mzzzv-taaaa-aaaal-qxlrq-cai',
  g2:'yfwyv-nyaaa-aaaal-qxpyq-cai',
  g2Pii:'zt5a6-yiaaa-aaaal-qxp5q-cai',
});
const governor=loadOperatorIdentity(pemPath);
if (governor.getPrincipal().toText()!==GROUP2_GOVERNOR)
  throw new Error('Original pinned DEV governor required before any canister read');
const agent=await HttpAgent.create({host:'https://icp-api.io',identity:governor});
const router=Actor.createActor<RouterService>(routerIdl,{agent,canisterId:P.router});
const identity=Actor.createActor<IdentityService>(identityIdl,{agent,canisterId:P.identity});
const sources=[
  {group:'g1',id:P.g1},
  {group:'g2',id:P.g2},
].map(s=>({...s,actor:Actor.createActor<ClubService>(clubIdl,{agent,canisterId:s.id})}));
function unwrap<T>(reply:{Ok:T}|{Err:string},label:string):T {
  if ('Err' in reply)throw new Error(label+' refused: '+reply.Err);
  return reply.Ok;
}
const readRegistry=()=>readPinnedGroupRegistry((rev,cursor,limit)=>
  router.read_group_registry_page('mainnet',rev,cursor,limit));
const verifyRegistry=async()=>{
  const s=await readRegistry();
  if(s.revision!==11n || s.groups.length!==1 || s.placements.length!==1 ||
      s.groups[0].id!=='g2' || s.placements[0].group_id!=='g2' ||
      s.groups[0].domains.find(d=>d.domain==='club_domain')?.canister.toText()!==P.g2 ||
      s.groups[0].domains.find(d=>d.domain==='pii_access_control')?.canister.toText()!==P.g2Pii ||
      s.placements[0].deployment_id!=='mainnet' ||
      s.placements[0].deployment_revision!==1n ||
      s.placements[0].host!=='https://icp-api.io' ||
      s.placements[0].network_kind!=='public_mainnet')
    throw new Error('DEV router revision 11 or source authority has changed; refuse');
  return s;
};
const verifyDirectory=async(expectedReleased:boolean)=>{
  const c=unwrap(await identity.read_membership_directory_configuration(),'Identity directory config');
  const expected=[['g1',P.g1],['g2',P.g2]];
  if(!c.enabled || c.app_enabled!==expectedReleased || c.generation!==2n ||
     c.binding.registry.toText()!==P.router || c.binding.registry_revision!==11n ||
     c.binding.target_alias!=='mainnet' || c.binding.deployment_id!=='mainnet' ||
     c.binding.deployment_revision!==1n || c.binding.host!=='https://icp-api.io' ||
     c.binding.network_kind!=='public_mainnet' || c.inventory_digest.length!==32 ||
     fingerprint(c.sources.map(([g,p])=>[g,p.toText()]))!==fingerprint(expected))
    throw new Error('Exact generation-2 DEV directory identity, sources or reader state changed');
  return c;
};
const verifySources=async(config:Awaited<ReturnType<typeof verifyDirectory>>)=>{
  const seen=[] as Array<{group:string;revision:string;acknowledged:string;pending:boolean}>;
  for(const s of sources){
    const bound=unwrap(await s.actor.read_membership_directory_source_binding(),s.group+' binding');
    const grant=bound.binding[0];
    if(!bound.enabled || bound.binding.length!==1 || !grant ||
       grant.identity.toText()!==P.identity || grant.router.toText()!==P.router ||
       grant.group!==s.group || grant.deployment!=='mainnet' ||
       grant.generation!==2n || fingerprint(grant.inventory_digest)!==fingerprint(config.inventory_digest))
      throw new Error('Foreign or changed DEV source binding: '+s.group);
    const status=unwrap(await s.actor.read_membership_discovery_status(),s.group+' status');
    if(status.revision<1n || status.acknowledged!==status.revision || status.pending!==false)
      throw new Error('Membership source has pending or unacknowledged changes: '+s.group);
    seen.push({group:s.group,revision:String(status.revision),
      acknowledged:String(status.acknowledged),pending:false});
  }
  return seen;
};
const report=(name:string,body:Record<string,unknown>)=>{
  mkdirSync(resolve(reportDirectory),{recursive:true});
  writeFileSync(resolve(reportDirectory,name),JSON.stringify(body,null,2));
};
const initialRouter=await verifyRegistry();
const initialConfiguration=groupApprovalConfiguration(initialRouter.groups,initialRouter.placements);
// Use routing-authority evidence, not ShardGroup health/cycle/heap telemetry.
const initialRouterFingerprint=readerRouterAuthorityFingerprint(initialRouter,initialConfiguration);
const initial=await verifyDirectory(false);
const initialDirectoryFingerprint=fingerprint(initial);
const preflight=async()=>{
  const currentRouter=await verifyRegistry();
  if(readerRouterAuthorityFingerprint(currentRouter,
       groupApprovalConfiguration(currentRouter.groups,currentRouter.placements))!==initialRouterFingerprint)
    throw new Error('DEV router configuration changed during release preflight');
  if(fingerprint(await verifyDirectory(false))!==initialDirectoryFingerprint)
    throw new Error('DEV directory changed during release preflight');
};
const statuses=await verifySources(initial);
await preflight();
const acceptance=unwrap(await identity.check_membership_directory_acceptance(),'Identity snapshot acceptance');
if(!acceptance.snapshot_verified || !acceptance.restoration_guard_verified ||
   acceptance.app_enabled || acceptance.verified_current ||
   fingerprint([...acceptance.source_revisions].sort((a,b)=>a[0].localeCompare(b[0])))!==
   fingerprint(statuses.map(s=>[s.group,BigInt(s.revision)]).sort((a,b)=>a[0].localeCompare(b[0]))))
  throw new Error('Owner-verified generation-2 membership acceptance differs from source status');
const after=await verifySources(initial);
if(fingerprint(after)!==fingerprint(statuses))
  throw new Error('Membership source revisions changed during release preflight');
await preflight();
const plan={version:1,purpose:'private-membership-reader-only',environment:'ignite-dev',
  releaseCommit:commit,identityCanister:P.identity,routerCanister:P.router,
  routerRevision:'11',directoryGeneration:'2',
  routerFingerprint:initialRouterFingerprint,directoryFingerprint:initialDirectoryFingerprint,
  sources:statuses,snapshotVerified:true,restorationGuardVerified:true,readerCurrentlyClosed:true};
const planHash=createHash('sha256').update(fingerprint(plan)).digest('hex');
if(action==='check'){
  report('check.json',{action:'check',status:'release-preflight-passed-reader-closed',
    planHash,commit,routerRevision:'11',generation:'2',sources:statuses,
    snapshotVerified:true,restorationGuardVerified:true,
    readerReleased:false,noModifications:true,noPrivateNames:true,noProdOrSupabase:true});
  console.log('DEV generation-2 reader release PRECHECK passed; no changes. Plan hash: '+planHash);
  process.exit(0);
}
if(checkedPlan!==planHash) {
  // Save non-PII evidence to distinguish a real source/authority drift from a
  // stale operator hash. NEVER substitute the newly observed hash as consent.
  report('mismatch.json',{action:'release',status:'plan-mismatch-reader-closed',
    requestedPlanHash:checkedPlan,observedPlanHash:planHash,
    releaseCommit:commit,routerRevision:'11',generation:'2',
    sources:statuses,readerReleased:false,noModifications:true,
    noPrivateNames:true,noProdOrSupabase:true});
  throw new Error('Checked DEV reader release plan is stale/mismatched; no changes made');
}
report('intent.json',{action:'release',status:'intent-before-one-identity-call',
  planHash,commit,target:P.identity,generation:'2',readerResult:'unknown',
  noCanisterUpgrades:true,noPrivateNames:true,noProdOrSupabase:true});
const enabled=unwrap(await identity.enable_membership_directory(commit),'DEV identity reader release');
if(!enabled.app_enabled || !enabled.snapshot_verified || !enabled.restoration_guard_verified ||
   enabled.verified_current ||
   fingerprint([...enabled.source_revisions].sort((a,b)=>a[0].localeCompare(b[0])))!==
   fingerprint(statuses.map(s=>[s.group,BigInt(s.revision)]).sort((a,b)=>a[0].localeCompare(b[0]))))
  throw new Error('Identity reader release reply did not match the checked source revisions; do not retry blindly');
const confirmed=await verifyDirectory(true);
const nowRouter=await verifyRegistry();
if(readerRouterAuthorityFingerprint(nowRouter,
     groupApprovalConfiguration(nowRouter.groups,nowRouter.placements))!==initialRouterFingerprint ||
   fingerprint({...confirmed,app_enabled:false})!==initialDirectoryFingerprint)
  throw new Error('Reader release readback changed or unverifiable; do not retry blindly');
report('release.json',{action:'release',status:'reader-enabled-with-identity-owned-snapshot-check',
  planHash,commit,generation:'2',sourceRevisions:statuses,readerReleased:true,
  snapshotVerified:true,restorationGuardVerified:true,realUserPageTested:false,
  privateNamesReleased:false,noCanisterUpgrades:true,noProdOrSupabase:true});
console.log('DEV generation-2 membership reader released after snapshot verification; no canister upgrades or private-name permission changes.');
