/** Owner-gated Group 2 club-roster ONLY release on public ICP mainnet.
 * check is read-only; upgrade installs ONLY the pinned existing club_domain.
 * No queue, notifications, other services, G1, PROD, users or settings writes.
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
import { requireWiring } from '../../scripts/g2-event-notification-upgrade-policy.mjs';
import { TARGET, validateRequest, validateTarget, validateRegistration, validateJournal, executeUpgrade } from '../../scripts/g2-club-roster-release-policy.mjs';

const [action, artifactDir, pem, reportDir] = process.argv.slice(2);
validateRequest({
  action, confirmation:process.env.CONFIRMATION?.trim(),
  release:process.env.EXPECTED_RELEASE_SHA?.trim(), actualCommit:process.env.GITHUB_SHA?.trim(),
  oldHash:process.env.EXPECTED_CLUB_HASH?.trim(),
});
if (!artifactDir || !pem || !reportDir) throw Error('Artifact directory, existing governor PEM and report directory required');
if (process.env.GITHUB_REPOSITORY !== 'Ignite-Club-HQ/ignite-club_hq-prod' ||
    process.env.GITHUB_REF !== 'refs/heads/main')
  throw Error('Only the exact Ignite main branch may preflight or release');
const root = new URL('../../', import.meta.url);
const json = (p:string) => JSON.parse(readFileSync(new URL(p,root),'utf8'));
const shared=json('deploy/mainnet/.icp/data/mappings/ic.ids.json');
const provision=json('deploy/groups/g2/provision.json');
if (shared.shard_router !== 'jcdfe-vqaaa-aaaal-qxloq-cai' ||
    shared.identity_access !== 'mq2sj-fiaaa-aaaal-qxlqa-cai')
  throw Error('Unexpected shared mainnet routing identity');
const inventory=validateGroup2Inventory(provision,shared,'g2');
const item=inventory.find((s:any)=>s.name===TARGET.name);
if (!item || item.canisterId!==TARGET.canisterId) throw Error('Club-domain inventory does not match pinned Group 2');
const file=resolve(artifactDir,TARGET.name);
const target={...TARGET,subnetId:item.subnetId,newHash:wasmHash(readFileSync(file)),file};
validateTarget(target,provision);
const identity=loadOperatorIdentity(resolve(pem));
if (identity.getPrincipal().toText()!==GROUP2_GOVERNOR) throw Error('Existing Group 2 governor identity required');
mkdirSync(reportDir,{recursive:true});
const agent=await HttpAgent.create({host:'https://icp-api.io',identity});
const router=Actor.createActor(routerIdl,{agent,canisterId:shared.shard_router});
const registry=()=>readPinnedGroupRegistry((revision:any,cursor:any,limit:any)=>
  router.read_group_registry_page('mainnet',revision,cursor,limit));
const initial=await registry();
if (initial.configurationRevision===undefined) throw Error('Registry configuration revision required');
validateRegistration(target,initial.groups,initial.placements,provision);
const config=groupApprovalConfiguration(initial.groups,initial.placements);
const configHash=digest(config);

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
const configIdl=()=>IDL.Service({
  read_group_opening_configuration:IDL.Func([],[IDL.Vec(IDL.Tuple(IDL.Text,IDL.Text))],[])
});
const memoryIdl=()=>IDL.Service({
  memory_stats:IDL.Func([],[IDL.Record({heap_bytes:IDL.Nat,memory_bytes:IDL.Nat,stable_bytes:IDL.Nat})],['query'])
});
const usageIdl=()=>IDL.Service({
  usage_stats:IDL.Func([],[IDL.Record({clubs:IDL.Nat,teams:IDL.Nat,accounts:IDL.Nat,news_posts:IDL.Nat})],['query'])
});
const wiring=async()=>{
  const actor=Actor.createActor(configIdl,{agent,canisterId:TARGET.canisterId});
  return requireWiring('club_domain',await actor.read_group_opening_configuration(),provision);
};
const observe=async()=>{
  const cid=Principal.fromText(TARGET.canisterId);
  const mgmt=Actor.createActor(managementIdl,{agent,canisterId:'aaaaa-aa',effectiveCanisterId:cid});
  const status=await mgmt.canister_status({canister_id:cid});
  const certified=await CanisterStatus.request({agent,canisterId:cid,paths:['subnet']});
  const actual={
    moduleHash:Buffer.from(status.module_hash[0]??[]).toString('hex'),
    controllers:status.settings.controllers.map((x:any)=>x.toText()),
    running:'running' in status.status,
    cycles:status.cycles,
    subnetId:String(certified.get('subnet')?.subnetId??''),
    environment:status.settings.environment_variables
  };
  verifyUpgradeStatus(target,actual,GROUP2_GOVERNOR);
  const settings=status.settings;
  const settingsHash=digest({
    controllers:[...actual.controllers].sort(),
    compute_allocation:settings.compute_allocation,memory_allocation:settings.memory_allocation,
    freezing_threshold:settings.freezing_threshold,reserved_cycles_limit:settings.reserved_cycles_limit,
    wasm_memory_limit:settings.wasm_memory_limit,
    environment_variables:[...settings.environment_variables].sort((a:any,b:any)=>a.name.localeCompare(b.name))
  });
  const mem=Actor.createActor(memoryIdl,{agent,canisterId:TARGET.canisterId});
  const stats=Actor.createActor(usageIdl,{agent,canisterId:TARGET.canisterId});
  const [memory,usage]=await Promise.all([mem.memory_stats(),stats.usage_stats()]);
  return {
    moduleHash:actual.moduleHash,settingsHash,wiringHash:await wiring(),
    cycles:String(actual.cycles),stableBytes:String(memory.stable_bytes),clubs:String(usage.clubs)
  };
};
const gate=async()=>{
  const now=await registry();
  if(now.revision!==initial.revision || now.configurationRevision!==initial.configurationRevision ||
      groupApprovalConfiguration(now.groups,now.placements)!==config)
    throw Error('Router or placement changed; stop');
  validateRegistration(target,now.groups,now.placements,provision);
  await wiring();
};
await gate();
const baseline=await observe();
await gate();
const report={
  action,sourceSha:process.env.GITHUB_SHA,host:'https://icp-api.io',group:'g2',mainnet:true,
  governor:GROUP2_GOVERNOR,router:shared.shard_router,
  registryRevision:String(initial.revision),configurationRevision:String(initial.configurationRevision),
  configurationHash:configHash,
  targets:[{
    name:TARGET.name,groupId:'g2',canisterId:TARGET.canisterId,subnetId:target.subnetId,
    oldHash:baseline.moduleHash,newHash:target.newHash,
    settingsHash:baseline.settingsHash,wiringHash:baseline.wiringHash,
    cycles:baseline.cycles,stableBytes:baseline.stableBytes,clubs:baseline.clubs
  }]
};
writeFileSync(join(reportDir,'check.json'),JSON.stringify(report,null,2));
if(action==='check') {
  console.log('G2 club_domain ONLY read-only preflight complete; no canister installed or settings changed.');
  process.exit(0);
}
const expectedOld=process.env.EXPECTED_CLUB_HASH!.trim();
if(baseline.moduleHash!==expectedOld) throw Error('Live club_domain hash changed since reviewed preflight');
const binding={
  release:process.env.GITHUB_SHA,governor:GROUP2_GOVERNOR,
  router:shared.shard_router,registryRevision:String(initial.revision),configurationHash:configHash,
  provision:{
    groupId:provision.groupId,deploymentId:provision.deploymentId,subnetId:provision.subnetId,
    canisters:{club_domain:provision.canisters.club_domain,notification_queue:provision.canisters.notification_queue,events_domain:provision.canisters.events_domain},
    observedSubnets:{club_domain:provision.observedSubnets.club_domain},
    dedicatedBlobStore:{canisterId:provision.dedicatedBlobStore.canisterId}
  },
  provisionHash:digest(provision),oldHash:expectedOld,
  target:{name:target.name,groupId:target.groupId,canisterId:target.canisterId,subnetId:target.subnetId,newHash:target.newHash}
};
validateTarget(binding.target,binding.provision);
const api=createJournalApi(process.env.GITHUB_REPOSITORY!,JSON.stringify);
const branch='g2-club-roster-release-receipts';
const refs=api('git/matching-refs/heads/'+branch);
if(!refs.some((r:any)=>r.ref==='refs/heads/'+branch)){
  const meta=api('');const base=api('git/ref/heads/'+meta.default_branch);
  api('git/refs','POST',{ref:'refs/heads/'+branch,sha:base.object.sha});
}
const path='contents/deploy/groups/g2/club-roster-release.json';
const entries=api('contents/deploy/groups/g2?ref='+branch);
if(!Array.isArray(entries))throw Error('Cannot list receipt directory');
let stored=entries.some((r:any)=>r.name==='club-roster-release.json')?api(path+'?ref='+branch):null;
let journal;
if(stored?.content){
  journal=JSON.parse(Buffer.from(stored.content,'base64').toString());
  validateJournal(journal,binding);
}else{
  journal={
    group:'g2',binding,routerRevision:String(initial.revision),configurationHash:configHash,
    complete:false,
    step:{
      name:TARGET.name,groupId:'g2',canisterId:TARGET.canisterId,subnetId:target.subnetId,
      oldHash:baseline.moduleHash,newHash:target.newHash,
      settingsHash:baseline.settingsHash,wiringHash:baseline.wiringHash,phase:'ready'
    }
  };
}
validateJournal(journal,binding);
const persist=async()=>{
  stored=persistGroup2Journal(api,path,branch,stored,journal,'club-roster-only');
  writeFileSync(join(reportDir,'progress.json'),JSON.stringify(journal,null,2));
};
if(!stored) await persist();
const guardedGate=async()=>{
  await gate();
  if(await wiring()!==journal.step.wiringHash) throw Error('Cross-canister authority changed');
};
await executeUpgrade(journal,{
  gate:guardedGate,observe,persist,
  install:async()=>{
    const args=upgradeArgs(target,file,GROUP2_GOVERNOR);
    const response=spawnSync('icp',args,{cwd:reportDir,stdio:'inherit'});
    if(response.status!==0)throw Error('Install failed/unknown; durable pending receipt preserved; no automatic retry');
  }
});
writeFileSync(join(reportDir,'complete.json'),JSON.stringify({
  sourceSha:binding.release,group:'g2',complete:true,services:[{
    name:TARGET.name,canisterId:TARGET.canisterId,moduleHash:target.newHash
  }]
},null,2));
console.log('Only the pinned Group 2 club_domain upgraded, hash and wiring read back, no other service touched.');
