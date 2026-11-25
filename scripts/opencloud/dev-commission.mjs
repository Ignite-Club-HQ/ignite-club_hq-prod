import {commissioning} from './deployment.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { identityFromPem } from '../prod-connection-check.mjs';
import { guard, activation, MANAGEMENT_PROXY } from './dev-auto.mjs';
const [work, timerWork, mode] = process.argv.slice(2);
if (!['check','commission'].includes(mode)) throw Error('Explicit mode required');
const config = JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
const peer = JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const rows = guard({config,peer,branch:process.env.GITHUB_REF_NAME});
if (activation(config).autoDeploy || activation(config).lovableRouting) throw Error('Activation must remain off');
const m = JSON.parse(fs.readFileSync(path.join(work,'manifest.json')));
if(m.environment!=='opencloud-dev'||m.applicationKey!=='ignite_dev_v2'||m.canisters.length!==32||m.engine.operatorId!==MANAGEMENT_PROXY) throw Error('Wrong manifest');
const require = createRequire(path.resolve('frontend/package.json'));
const {HttpAgent,Actor}=require('@icp-sdk/core/agent');
const {IDL:I}=require('@icp-sdk/core/candid');
const {Principal}=require('@icp-sdk/core/principal');
const {Ed25519KeyIdentity}=require('@icp-sdk/core/identity');
const {Secp256k1KeyIdentity}=require('@icp-sdk/core/identity/secp256k1');
const identity=identityFromPem(fs.readFileSync(process.env.GOVERNOR_PEM_FILE,'utf8'),{Ed25519KeyIdentity,Secp256k1KeyIdentity});
if(identity.getPrincipal().toText()!==config.controllers.governor) throw Error('Wrong governor');
const agent=await HttpAgent.create({host:config.apiHost,identity,shouldFetchRootKey:false});
const B=I.Vec(I.Nat8), P=I.Principal, E=I.Vec(I.Record({name:I.Text,value:I.Text}));
const proxy=Actor.createActor(()=>I.Service({proxy:I.Func([I.Record({method:I.Text,args:B,canister_id:P,cycles:I.Nat})],[I.Variant({Ok:I.Record({result:B}),Err:I.Variant({CallFailed:I.Record({reason:I.Text}),InsufficientCycles:I.Record({available:I.Nat,required:I.Nat}),UnauthorizedUser:I.Null})})],[])}),{agent,canisterId:MANAGEMENT_PROXY});
const pid = text => Principal.fromText(text);
const call=async(method,type,arg,returns=[])=>{const r=await proxy.proxy({method,args:new Uint8Array(I.encode([type],[arg])),canister_id:pid('aaaaa-aa'),cycles:0n});if(!('Ok' in r))throw Error('Proxy refused '+method);return I.decode(returns,Uint8Array.from(r.Ok.result));};
const Target=I.Record({canister_id:P});
const Status=I.Record({module_hash:I.Opt(B),settings:I.Record({controllers:I.Vec(P),environment_variables:E,wasm_memory_limit:I.Nat})});
const status=async id=>(await call('canister_status',Target,{canister_id:pid(id)},[Status]))[0];
const hash=b=>createHash('sha256').update(b).digest('hex');
const expectedControllers=[MANAGEMENT_PROXY,config.controllers.owner,config.controllers.connectedIdentity,config.controllers.governor].sort();
const verifyControllers=s=>{if(JSON.stringify(s.settings.controllers.map(p=>p.toText()).sort())!==JSON.stringify(expectedControllers))throw Error('Controller mismatch');};

const timer=JSON.parse(fs.readFileSync(path.join(timerWork,'manifest.json')));
if(timer.environment!==config.environment||timer.applicationKey!==config.applicationKey)throw Error('Wrong timer manifest');
const modules=[];
for(const r of rows.filter(r=>r.service!=='frontend')){
 const a=(r.service==='timer_jobs'?timer:m).canisters.find(x=>x.name===r.name);
 if(!a||a.id!==r.id||a.service!==r.service||! /^[a-f0-9]{64}$/.test(a.moduleSha256))throw Error('Manifest mismatch '+r.name);
 const s=await status(r.id);verifyControllers(s);
 if(s.module_hash.length!==1||Buffer.from(s.module_hash[0]).toString('hex')!==a.moduleSha256)throw Error('Live module mismatch '+r.name);
 if(!['placement_registry','migration_coordinator'].includes(r.service))modules.push([pid(r.id),Array.from(s.module_hash[0])]);
}
if(modules.length!==29)throw Error('Wrong authority count');
const T=I.Text,N=I.Nat64,V=I.Vec,R=I.Record;
const Domain=R({domain:T,canister:P}), DP=R({domain:T,canister:P,subnet:P});
const Group=R({id:T,target_alias:T,domains:V(Domain),accepting:I.Bool,photo_store:I.Opt(P),assigned_clubs:I.Nat32,max_clubs:I.Nat32});
const Placement=R({group_id:T,deployment_id:T,deployment_revision:N,host:T,network_kind:T,primary_subnet:P,approved_subnets:V(P),additional_subnets_enabled:I.Bool,domains:V(DP)});
const Page=R({groups:V(Group),placements:V(Placement),revision:N,next_cursor:I.Opt(T),configuration_revision:I.Opt(N)});
const Binding=R({registry_revision:N,host:T,network_kind:T,deployment_revision:N,target_alias:T,registry:P,deployment_id:T});
const Snapshot=R({groups:V(R({id:T,target_alias:T,domains:V(Domain)})),placements:V(Placement),revision:N});
const Media=R({stores:V(P),active:I.Bool});
const Inventory=R({groups:R({binding:Binding,history_revision:N,snapshot:Snapshot}),supplemental:V(R({domain:T,group_id:T,subnet:P,canister:P})),media:V(R({club_authority:P,registry:Media}))});
const Expectation=R({identity:P,modules:V(I.Tuple(P,B)),inventory:Inventory});
const Receipt=R({expectation:Expectation,lifecycle:V(R({canister:P,module_hash:B,changes:N}))});
const invoke=async(id,method,types,args,ret=I.Null)=>{
 const actor=Actor.createActor(()=>I.Service({[method]:I.Func(types,[I.Variant({Ok:ret,Err:T})],[])}),{agent,canisterId:id});
 const out=await actor[method](...args);if(!('Ok' in out))throw Error(method+': '+out.Err);console.log(method+' OK');return out.Ok;
};
const router=config.shared.shard_router,id=config.shared.identity_access;
const page=await invoke(router,'read_group_registry_page',[T,I.Opt(N),I.Opt(T),I.Nat32],['opencloud-dev',[],[],64],Page);
if(page.next_cursor.length||page.groups.length!==2||page.placements.length!==2||page.revision!==4n)throw Error('Unexpected registry');
const eq=(a,b)=>a.toText()===b;
for(const [i,g] of config.groups.entries()){
 const name=i===0?'base':'g2', live=page.groups.find(x=>x.id===name),p=page.placements.find(x=>x.group_id===name);
 const domains=Object.entries(g.canisterIds).filter(([k])=>k!=='media_blob_store').concat([['secret_workload_identity',config.shared.secret_workload_identity]]);
 if(!live||!p||live.accepting||live.assigned_clubs!==0||live.max_clubs!==g.maxClubs||live.target_alias!==config.environment||live.photo_store.length!==1||!eq(live.photo_store[0],g.canisterIds.media_blob_store)||p.deployment_revision!==1n||p.host!==config.apiHost||p.network_kind!=='cloud_engine'||p.deployment_id!==config.environment||p.additional_subnets_enabled||!eq(p.primary_subnet,config.subnetId)||p.approved_subnets.length!==1||!eq(p.approved_subnets[0],config.subnetId)||live.domains.length!==domains.length||p.domains.length!==domains.length||domains.some(([k,v])=>!live.domains.some(d=>d.domain===k&&eq(d.canister,v))||!p.domains.some(d=>d.domain===k&&eq(d.canister,v)&&eq(d.subnet,config.subnetId))))throw Error('Group mismatch '+name);
}
const binding={registry_revision:page.revision,host:config.apiHost,network_kind:'cloud_engine',deployment_revision:1n,target_alias:config.environment,registry:pid(router),deployment_id:config.environment};
const media=[];
for(const g of config.groups){const registry=await invoke(g.canisterIds.club_domain,'read_removal_media_registry',[],[],Media);if(registry.stores.length!==1||!eq(registry.stores[0],g.canisterIds.media_blob_store))throw Error('Media registry mismatch');media.push({club_authority:pid(g.canisterIds.club_domain),registry});}
const supplemental=[{domain:'shard_router',group_id:'',subnet:pid(config.subnetId),canister:pid(router)},...config.groups.map((g,i)=>({domain:'media_blob_store',group_id:i===0?'base':'g2',subnet:pid(config.subnetId),canister:pid(g.canisterIds.media_blob_store)}))];
const history=await invoke(id,'read_production_account_history_revision',[],[],N);
const expected={identity:pid(id),modules,inventory:{groups:{binding,history_revision:history,snapshot:{groups:page.groups,placements:page.placements,revision:page.revision}},supplemental,media}};
if(mode==='check'){console.log('Live hashes and registry verified; no writes');process.exit(0);}
for(const c of commissioning(config).filter(c=>c.step===4))await invoke(c.target,c.method,[P],[pid(id)]);
await invoke(id,'review_production_account_inventory',[Expectation,N],[expected,history],I.Reserved);
await invoke(id,'commission_fresh_opencloud_dev',[Expectation],[expected],Receipt);
await invoke(id,'authorize_production_member_access',[Binding],[binding]);
await invoke(id,'configure_membership_directory',[Binding,V(P),N],[binding,config.groups.map(g=>pid(g.canisterIds.club_domain)),1n],I.Reserved);
await invoke(id,'read_fresh_opencloud_dev_commissioning',[],[],Receipt);
await invoke(id,'read_membership_directory_configuration',[],[],I.Reserved);
console.log('DEV commissioning complete; admission remains closed');
