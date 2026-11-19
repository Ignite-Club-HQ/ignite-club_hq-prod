/** Exact DEV Identity-first / Group-2-only staged release, with durable intent.
 * No environment/controller/PII/permission writes, frontend sync or PROD.
 * A missing install acknowledgement is NEVER automatically retried.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Actor, HttpAgent, CanisterStatus } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { GROUP2_GOVERNOR, wasmHash, verifyUpgradeStatus } from '../../scripts/group2-upgrade-rules.mjs';
import { digest, installArgs } from '../../scripts/all-group-upgrade-policy.mjs';
import { canonicalSettingRows } from '../../scripts/private-name-cleanup-release-policy.mjs';
import { FIRST_CONTENT_DEV as pins, verifyFirstContentStage } from '../../scripts/dev-first-content-stage-policy.mjs';
import { verifyExactPreviousWasms } from '../../scripts/dev-first-content-recovery-gate.mjs';
import { createJournalApi } from './media-stage-two-github.mjs';
import { persistGroup2Journal } from '../../scripts/group2-journal.mjs';

const [preflightPath,artifactDirectory,reportDirectory,pem] = process.argv.slice(2);
if(!preflightPath||!artifactDirectory||!reportDirectory||!pem)throw Error('Fresh preflight, two Wasm artifacts, report path and existing governor required');
const action=process.env.ACTION,stage=process.env.STAGE;
const sourceRevision=process.env.GITHUB_SHA;
const repo=process.env.GITHUB_REPOSITORY;
const checkedPlan=process.env.CHECKED_PLAN??'',confirmation=process.env.CONFIRMATION??'';
mkdirSync(reportDirectory,{recursive:true});
const report=JSON.parse(readFileSync(preflightPath,'utf8'));
const candidateHashes=Object.fromEntries([pins.identity,pins.club].map(s=>[s.name,wasmHash(readFileSync(resolve(artifactDirectory,s.name)))]));
const {binding,planHash,target}=verifyFirstContentStage({action,stage,sourceRevision,
  candidateHashes,report,checkedPlan,confirmation});
const save=(file:string,data:unknown)=>writeFileSync(join(reportDirectory,file),JSON.stringify(data,null,2)+'\n');
save('stage-check.json',{action:'check',stage,sourceRevision,planHash,binding,liveAcceptance:false});
console.log('Exact DEV first-content '+stage+' plan checked: '+planHash);

const operator=loadOperatorIdentity(pem);
if(operator.getPrincipal().toText()!==GROUP2_GOVERNOR)throw Error('Pinned DEV governor required');
const agent=await HttpAgent.create({host:'https://icp-api.io',identity:operator});
const mgmtIdl=()=>IDL.Service({canister_status:IDL.Func([IDL.Record({canister_id:IDL.Principal})],[IDL.Record({
  status:IDL.Variant({running:IDL.Null,stopped:IDL.Null,stopping:IDL.Null}),
  module_hash:IDL.Opt(IDL.Vec(IDL.Nat8)),cycles:IDL.Nat,
  settings:IDL.Record({controllers:IDL.Vec(IDL.Principal),compute_allocation:IDL.Nat,memory_allocation:IDL.Nat,
    freezing_threshold:IDL.Nat,reserved_cycles_limit:IDL.Nat,wasm_memory_limit:IDL.Nat,
    environment_variables:IDL.Vec(IDL.Record({name:IDL.Text,value:IDL.Text}))})
})],[])});
async function observe(service:typeof pins.identity){
  const cid=Principal.fromText(service.id);
  const mgmt=Actor.createActor(mgmtIdl,{agent,canisterId:'aaaaa-aa',effectiveCanisterId:cid} as Parameters<typeof Actor.createActor>[1]) as unknown as {canister_status(a:{canister_id:Principal}):Promise<any>};
  const s=await mgmt.canister_status({canister_id:cid});
  const cert=await CanisterStatus.request({agent,canisterId:cid,paths:['subnet']});
  const actual={moduleHash:Buffer.from(s.module_hash[0]??[]).toString('hex'),
    controllers:s.settings.controllers.map((p:Principal)=>p.toText()),
    running:'running' in s.status,cycles:s.cycles,
    subnetId:String((cert.get('subnet') as {subnetId?:Principal}|undefined)?.subnetId??''),
    environment:s.settings.environment_variables};
  verifyUpgradeStatus({name:service.name,groupId:service.groupId,canisterId:service.id,subnetId:pins.subnet},actual,GROUP2_GOVERNOR);
  const settingsHash=digest({...s.settings,controllers:actual.controllers,environment_variables:canonicalSettingRows(actual.environment)});
  if(settingsHash!==service.settings)throw Error('DEV '+service.name+' settings drift; no install allowed');
  // The optimisation remains OFF for both stages. No stage may activate it.
  if(service.name==='club_domain' && actual.environment.some((e:{name:string,value:string})=>
    e.name==='IGNITE_FIRST_CONTENT_COMBINED_ADMISSION' && e.value==='1'))
    throw Error('Combined admission flag already enabled; staged release cannot continue');
  return {moduleHash:actual.moduleHash,settingsHash,cycles:String(s.cycles)};
}
const services=[pins.identity,pins.club];
const expectedBefore=stage==='identity'?[pins.identity.old,pins.club.old]:[pins.identity.next,pins.club.old];
async function observeBoth(expected:[string,string]){
  const result=await Promise.all(services.map(observe));
  for(let i=0;i<services.length;i++)if(result[i].moduleHash!==expected[i])
    throw Error('DEV '+services[i].name+' unexpected installed module: abort without an install');
  return result;
}
const before=await observeBoth(expectedBefore as [string,string]);
save('stage-live-before.json',{stage,targets:services.map((s,i)=>({id:s.id,group:s.groupId,moduleHash:before[i].moduleHash,settingsHash:before[i].settingsHash,cycles:before[i].cycles}))});
if(action==='check') {
  console.log('Read-only stage check complete. No canister or GitHub receipt written.');
  process.exit(0);
}
if(action!=='upgrade')throw Error('Only check or upgrade allowed');
const previousWasmDirectory=process.env.DEV_FIRST_CONTENT_RECOVERY_DIR;
if(!previousWasmDirectory)throw Error('Two verified archived prior Wasm bytes required before any live install');
verifyExactPreviousWasms({
  identity_access:readFileSync(resolve(previousWasmDirectory,'identity_access.wasm')),
  club_domain:readFileSync(resolve(previousWasmDirectory,'club_domain.wasm')),
});
if(repo!=='Ignite-Club-HQ/ignite-club_hq-prod')throw Error('Wrong GitHub repository; no installation');
if(!process.env.GH_TOKEN)throw Error('Protected GitHub journal token unavailable');
const api=createJournalApi(repo,JSON.stringify);
const branch='dev-first-content-upgrade-receipts',path='contents/dev-first-content-upgrade.json';
const refs=api('git/matching-refs/heads/');
const exists=refs.some((r:{ref:string})=>r.ref===`refs/heads/${branch}`);
let stored:any=null;
if(exists){
  const tree=api(`git/trees/${branch}?recursive=1`);
  if(tree.truncated)throw Error('Incomplete release journal branch; no installation');
  if(tree.tree.some((r:{path:string})=>r.path==='dev-first-content-upgrade.json'))stored=api(`${path}?ref=${branch}`);
}
let journal:any=stored?JSON.parse(Buffer.from(stored.content,'base64').toString('utf8')):null;
if(journal){
  if(journal.repo!==repo||journal.governor!==pins.governor||journal.version!==1||
      Object.keys(journal.stages??{}).some(s=>!['identity','g2_club'].includes(s)))
    throw Error('Foreign or invalid stage journal; no installation');
  const identity=journal.stages?.identity;
  if(stage==='g2_club' && (identity?.phase!=='complete'||identity?.candidate!==pins.identity.next))
    throw Error('Shared Identity must be fully journalled and verified before Group 2 Club');
  if(journal.stages?.[stage])throw Error('Stage has a prior intent or completed record; never replay automatically');
}else{
  if(stage!=='identity')throw Error('No completed Identity stage journal; Group 2 Club cannot start');
  journal={version:1,repo,governor:pins.governor,stages:{}};
}
if(!exists)api('git/refs','POST',{ref:`refs/heads/${branch}`,sha:sourceRevision});
// Check live status again immediately before writing intent.
await observeBoth(expectedBefore as [string,string]);
journal.stages[stage]={phase:'pending',sourceRevision,checkedPlan:planHash,
  canisterId:target.id,oldHash:target.old,candidate:target.next,
  settings:target.settings};
stored=persistGroup2Journal(api,path,branch,stored,journal,'first-content '+stage+' install intent');
// Resolve the explicit, reviewed mainnet project: running icp from frontend
// searches upward and instead loads root icp.yaml (the disposable local lab),
// which expects .local-icp/identity-init.bin and prevents installation.
// Validate this configuration BEFORE recording a durable install intent.
const mainnetProject=resolve(import.meta.dirname,'../../deploy/mainnet');
const mainnetConfig=readFileSync(join(mainnetProject,'icp.yaml'),'utf8');
if(!mainnetConfig.includes('- ../../backend/identity_access')||
   !mainnetConfig.includes('- ../../backend/club_domain')||
   !mainnetConfig.includes('- name: ic')||mainnetConfig.includes('.local-icp/'))
  throw Error('Expected reviewed deploy/mainnet ICP project; refusing install before intent');
// Pending acknowledgement is durable BEFORE the only IC installation attempt.
const args=installArgs({name:target.name,groupId:target.groupId,canisterId:target.id,subnetId:pins.subnet},resolve(artifactDirectory,target.name));
const installed=spawnSync('icp',args,{cwd:mainnetProject,stdio:'inherit'});
if(installed.status!==0)throw Error('Install failed/unknown; pending intent retained. DO NOT RETRY; reconcile exact live module and receipt first.');
const afterExpected=stage==='identity'?[pins.identity.next,pins.club.old]:[pins.identity.next,pins.club.next];
const after=await observeBoth(afterExpected as [string,string]);
journal.stages[stage]={...journal.stages[stage],phase:'complete',verifiedModule:target.next};
stored=persistGroup2Journal(api,path,branch,stored,journal,'first-content '+stage+' verified completion');
save('stage-live-after.json',{stage,targets:services.map((s,i)=>({id:s.id,group:s.groupId,moduleHash:after[i].moduleHash,settingsHash:after[i].settingsHash,cycles:after[i].cycles})),liveAcceptance:false});
console.log('Exact '+stage+' module verified and journalled; combined admission remains disabled. No other module upgraded.');
