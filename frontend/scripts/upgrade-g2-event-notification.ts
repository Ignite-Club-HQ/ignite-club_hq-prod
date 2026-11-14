/** OWNER-GATED Group 2 mainnet notification release.
 * check = read-only; upgrade = exactly notification_queue then club_domain.
 * No canister creation, settings mutations, funding, notification sends,
 * frontend deployment, G1/PROD operations, or wholesale queue read.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Actor, HttpAgent, CanisterStatus } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { groupApprovalConfiguration } from '../src/live/groupApproval';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { createJournalApi } from './media-stage-two-github.mjs';
import { persistGroup2Journal } from '../../scripts/group2-journal.mjs';
import { GROUP2_GOVERNOR, validateGroup2Inventory, verifyUpgradeStatus, upgradeArgs, wasmHash } from '../../scripts/group2-upgrade-rules.mjs';
import { digest } from '../../scripts/subscription-upgrade-policy.mjs';
import { PAIR, validateRequest, validatePair, validateRegistration, requireWiring, validateJournal, executeTwoCanisterUpgrade } from '../../scripts/g2-event-notification-upgrade-policy.mjs';

const [action, artifacts, pem, directory] = process.argv.slice(2);
validateRequest({
  action, confirmation: process.env.CONFIRMATION?.trim(),
  release: process.env.EXPECTED_RELEASE_SHA?.trim(),
  actualCommit: process.env.GITHUB_SHA?.trim(),
  expectedQueueHash: process.env.EXPECTED_QUEUE_HASH?.trim(),
  expectedClubHash: process.env.EXPECTED_CLUB_HASH?.trim(),
});
if (!artifacts || !pem || !directory) throw Error('Artifact directory, existing PEM, report directory required');
if (process.env.GITHUB_REPOSITORY !== 'Ignite-Club-HQ/ignite-club_hq-prod' ||
    process.env.GITHUB_REF !== 'refs/heads/main') throw Error('Only the exact Ignite main branch is permitted');

const root=new URL('../../',import.meta.url);
const json=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const shared=json('deploy/mainnet/.icp/data/mappings/ic.ids.json');
const provision=json('deploy/groups/g2/provision.json');
if(shared.shard_router!=='jcdfe-vqaaa-aaaal-qxloq-cai' ||
   shared.identity_access!=='mq2sj-fiaaa-aaaal-qxlqa-cai') throw Error('Pinned shared mainnet routing mismatch');
const inventory=validateGroup2Inventory(provision,shared,'g2');
const targets=PAIR.map(p=>{
  const a=inventory.find(c=>c.name===p.name);
  if(!a || a.canisterId!==p.canisterId) throw Error('Unexpected group service mapping');
  const file=resolve(artifacts,p.name);
  const newHash=wasmHash(readFileSync(file));
  return {...p, subnetId:a.subnetId, file, newHash};
});
validatePair(targets,provision);
const identity=loadOperatorIdentity(resolve(pem));
if(identity.getPrincipal().toText()!==GROUP2_GOVERNOR) throw Error('Existing governor identity required');
mkdirSync(directory,{recursive:true});
const agent=await HttpAgent.create({host:'https://icp-api.io',identity});
const router=Actor.createActor(routerIdl,{agent,canisterId:shared.shard_router});
const registry=()=>readPinnedGroupRegistry((revision,cursor,limit)=>
  router.read_group_registry_page('mainnet',revision,cursor,limit));
const initial=await registry();
if(initial.configurationRevision===undefined) throw Error('Revision-bound public mainnet registry required');
validateRegistration(targets,initial.groups,initial.placements,provision);
const configuration=groupApprovalConfiguration(initial.groups,initial.placements);
const configurationHash=digest(configuration);

const managementIdl=()=>IDL.Service({canister_status:IDL.Func(
  [IDL.Record({canister_id:IDL.Principal})],
  [IDL.Record({
    status:IDL.Variant({running:IDL.Null,stopped:IDL.Null,stopping:IDL.Null}),
    module_hash:IDL.Opt(IDL.Vec(IDL.Nat8)),cycles:IDL.Nat,
    settings:IDL.Record({
      controllers:IDL.Vec(IDL.Principal),
      compute_allocation:IDL.Nat,memory_allocation:IDL.Nat,freezing_threshold:IDL.Nat,
      reserved_cycles_limit:IDL.Nat,wasm_memory_limit:IDL.Nat,
      environment_variables:IDL.Vec(IDL.Record({name:IDL.Text,value:IDL.Text}))
    })
  })],[])});
const configurationIdl=()=>IDL.Service({
  read_group_opening_configuration:IDL.Func([],[IDL.Vec(IDL.Tuple(IDL.Text,IDL.Text))],[])
});
const memoryIdl=()=>IDL.Service({
  memory_stats:IDL.Func([],[IDL.Record({heap_bytes:IDL.Nat,memory_bytes:IDL.Nat,stable_bytes:IDL.Nat})],['query'])
});
const usageIdl=()=>IDL.Service({
  usage_stats:IDL.Func([],[IDL.Record({clubs:IDL.Nat,teams:IDL.Nat,accounts:IDL.Nat,news_posts:IDL.Nat})],['query'])
});
const wiring=async t=>{
  const actor=Actor.createActor(configurationIdl,{agent,canisterId:t.canisterId});
  return requireWiring(t.name,await actor.read_group_opening_configuration(),provision);
};
const observe=async t=>{
  const cid=Principal.fromText(t.canisterId);
  const mgmt=Actor.createActor(managementIdl,{
    agent,canisterId:'aaaaa-aa',effectiveCanisterId:cid
  });
  const st=await mgmt.canister_status({canister_id:cid});
  const certified=await CanisterStatus.request({agent,canisterId:cid,paths:['subnet']});
  const subnet=certified.get('subnet');
  const settings=st.settings;
  const actual={
    moduleHash:Buffer.from(st.module_hash[0]??[]).toString('hex'),
    controllers:settings.controllers.map(x=>x.toText()),
    running:'running' in st.status,
    cycles:st.cycles,
    subnetId:String(subnet?.subnetId??''),
    environment:settings.environment_variables
  };
  verifyUpgradeStatus(t,actual,GROUP2_GOVERNOR);
  const settingsHash=digest({
    controllers:actual.controllers.sort(),
    compute_allocation:settings.compute_allocation,memory_allocation:settings.memory_allocation,
    freezing_threshold:settings.freezing_threshold,reserved_cycles_limit:settings.reserved_cycles_limit,
    wasm_memory_limit:settings.wasm_memory_limit,
    environment_variables:[...settings.environment_variables].sort((a,b)=>a.name.localeCompare(b.name))
  });
  const memory=Actor.createActor(memoryIdl,{agent,canisterId:t.canisterId});
  const bytes=await memory.memory_stats();
  let clubs;
  if(t.name==='club_domain'){
    const stats=Actor.createActor(usageIdl,{agent,canisterId:t.canisterId});
    clubs=(await stats.usage_stats()).clubs;
  }
  return {
    moduleHash:actual.moduleHash,settingsHash,wiringHash:await wiring(t),
    cycles:String(actual.cycles),stableBytes:String(bytes.stable_bytes),
    ...(clubs===undefined?{}:{clubs})
  };
};
const gate=async()=>{
  const now=await registry();
  if(now.revision!==initial.revision ||
     now.configurationRevision!==initial.configurationRevision ||
     groupApprovalConfiguration(now.groups,now.placements)!==configuration)
    throw Error('Group routing/placement changed; stop');
  validateRegistration(targets,now.groups,now.placements,provision);
  // Exact live cross-canister event/invite wiring is never modified by this runner.
  for(const target of targets) await wiring(target);
};

await gate();
const baseline=[];
for(const target of targets)baseline.push({...target,file:undefined,...(await observe(target))});
await gate();
const checkReport={
  action,sourceSha:process.env.GITHUB_SHA,host:'https://icp-api.io',
  group:'g2',mainnet:true,governor:GROUP2_GOVERNOR,
  router:shared.shard_router,registryRevision:String(initial.revision),
  configurationRevision:String(initial.configurationRevision),
  configurationHash,targets:baseline.map(({name,groupId,canisterId,subnetId,moduleHash,newHash,
    settingsHash,wiringHash,cycles,stableBytes,clubs})=>({
    name,groupId,canisterId,subnetId,oldHash:moduleHash,newHash,settingsHash,
    wiringHash,cycles,stableBytes,...(clubs===undefined?{}:{clubs:String(clubs)})
  }))
};
writeFileSync(join(directory,'check.json'),JSON.stringify(checkReport,null,2));
if(action==='check'){
  console.log('Read-only G2 event-notification pair preflight PASSED. Exact module hashes saved in check.json; no installs or state changes.');
  process.exit(0);
}

const oldHashes={
  notification_queue:process.env.EXPECTED_QUEUE_HASH.trim(),
  club_domain:process.env.EXPECTED_CLUB_HASH.trim()
};
const minimalProvision={
  groupId:provision.groupId,deploymentId:provision.deploymentId,subnetId:provision.subnetId,
  canisters:{notification_queue:provision.canisters.notification_queue,club_domain:provision.canisters.club_domain,events_domain:provision.canisters.events_domain},
  observedSubnets:{notification_queue:provision.observedSubnets.notification_queue,club_domain:provision.observedSubnets.club_domain},
  dedicatedBlobStore:{canisterId:provision.dedicatedBlobStore.canisterId}
};
const binding={
  release:process.env.GITHUB_SHA,governor:GROUP2_GOVERNOR,router:shared.shard_router,
  registryRevision:String(initial.revision),configurationHash,
  provision:minimalProvision,provisionHash:digest(provision),oldHashes,
  targets:targets.map(({file,...t})=>t)
};
validatePair(binding.targets,binding.provision);
// A single, immutable release binding is required for resumable actions.
// A pending install with unknown outcome NEVER gets blindly replayed.
const api=createJournalApi(process.env.GITHUB_REPOSITORY,JSON.stringify);
const branch='g2-notification-readback-receipts';
const refs=api('git/matching-refs/heads/'+branch);
if(!refs.some(r=>r.ref==='refs/heads/'+branch)){
  const meta=api('');const base=api('git/ref/heads/'+meta.default_branch);
  api('git/refs','POST',{ref:'refs/heads/'+branch,sha:base.object.sha});
}
const path='contents/deploy/groups/g2/notification-readback-upgrade.json';
const entries=api('contents/deploy/groups/g2?ref='+branch);
if(!Array.isArray(entries))throw Error('Cannot list durable journal directory; stop');
let stored=entries.some(entry=>entry.name==='notification-readback-upgrade.json')
  ? api(path+'?ref='+branch) : null;
// Never mistake GitHub transport/permission failure for an absent journal.
let journal;
if(stored?.content){
  journal=JSON.parse(Buffer.from(stored.content,'base64').toString());
  validateJournal(journal,binding);
} else {
  for(const item of baseline)if(item.moduleHash!==oldHashes[item.name])
    throw Error('Live pre-upgrade hash differs from the approved read-only report');
  journal={
    binding,routerRevision:String(initial.revision),configurationHash,complete:false,
    steps:baseline.map(({name,groupId,canisterId,subnetId,moduleHash,newHash,settingsHash,wiringHash})=>({
      name,groupId,canisterId,subnetId,oldHash:moduleHash,newHash,settingsHash,wiringHash,phase:'ready'
    }))
  };
}
validateJournal(journal,binding);
const persist=async()=>{
  stored=persistGroup2Journal(api,path,branch,stored,journal,'event-notification-pair');
  writeFileSync(join(directory,'progress.json'),JSON.stringify(journal,null,2));
};
if(!stored)await persist();
const managedGate=async()=>{
  await gate();
  for(const t of targets) {
    const step=journal.steps.find(x=>x.canisterId===t.canisterId);
    if(!step)throw Error('Unknown target in journal');
    const wh=await wiring(t);
    if(wh!==step.wiringHash)throw Error('Event/queue authority changed');
  }
};
await executeTwoCanisterUpgrade(journal,{
  gate:managedGate,observe,persist,
  install:async step=>{
    const t=targets.find(x=>x.canisterId===step.canisterId && x.name===step.name);
    if(!t)throw Error('Unapproved install target');
    // Existing icp CLI --mode upgrade and --wasm-memory-persistence keep.
    const command=upgradeArgs(t,t.file,GROUP2_GOVERNOR);
    const reply=spawnSync('icp',command,{cwd:directory,stdio:'inherit'});
    if(reply.status!==0)throw Error('Upgrade response failed or unknown; pending journal preserved; NO automatic retry');
  }
});
writeFileSync(join(directory,'complete.json'),JSON.stringify({
  release:binding.release,group:'g2',complete:true,
  services:journal.steps.map(x=>({name:x.name,canisterId:x.canisterId,moduleHash:x.newHash}))
},null,2));
console.log('G2 notification_queue + club_domain upgraded and read back; no other services installed; no notification sent.');
