import {commissioning} from './deployment.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { identityFromPem } from '../prod-connection-check.mjs';
import { guard, activation, MANAGEMENT_PROXY } from './dev-auto.mjs';
const mode=process.argv[2];
if (!['check','open'].includes(mode)) throw Error('Explicit mode required');
const config = JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
const peer = JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const rows = guard({config,peer,branch:process.env.GITHUB_REF_NAME});
if (activation(config).autoDeploy || activation(config).lovableRouting) throw Error('Activation must remain off');
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

const T=I.Text,N=I.Nat64,V=I.Vec,R=I.Record;
const Domain=R({domain:T,canister:P}), DP=R({domain:T,canister:P,subnet:P});
const Group=R({id:T,target_alias:T,domains:V(Domain),accepting:I.Bool,photo_store:I.Opt(P),assigned_clubs:I.Nat32,max_clubs:I.Nat32,heap_budget_bytes:N,heap_bytes:N,cycles:N,min_cycles:N,observed_at_ns:N});
const Placement=R({group_id:T,deployment_id:T,deployment_revision:N,host:T,network_kind:T,primary_subnet:P,approved_subnets:V(P),additional_subnets_enabled:I.Bool,domains:V(DP)});
const Page=R({groups:V(Group),placements:V(Placement),revision:N,next_cursor:I.Opt(T),configuration_revision:I.Opt(N)});
const invoke=async(id,method,types,args,ret=I.Null)=>{
 const actor=Actor.createActor(()=>I.Service({[method]:I.Func(types,[I.Variant({Ok:ret,Err:T})],[])}),{agent,canisterId:id});
 const out=await actor[method](...args);if(!('Ok' in out))throw Error(method+': '+out.Err);console.log(method+' OK');return out.Ok;
};
const router=config.shared.shard_router,id=config.shared.identity_access;
const page=await invoke(router,'read_group_registry_page',[T,I.Opt(N),I.Opt(T),I.Nat32],['opencloud-dev',[],[],64],Page);
if(page.next_cursor.length||page.groups.length!==2||page.placements.length!==2||page.revision<4n)throw Error('Unexpected registry');
const eq=(a,b)=>a.toText()===b;
for(const [i,g] of config.groups.entries()){
 const name=i===0?'base':'g2', live=page.groups.find(x=>x.id===name),p=page.placements.find(x=>x.group_id===name);
 const domains=Object.entries(g.canisterIds).filter(([k])=>k!=='media_blob_store').concat([['secret_workload_identity',config.shared.secret_workload_identity]]);
 if(!live||!p||(i===1&&live.accepting)||live.max_clubs!==g.maxClubs||live.target_alias!==config.environment||live.photo_store.length!==1||!eq(live.photo_store[0],g.canisterIds.media_blob_store)||p.deployment_revision!==1n||p.host!==config.apiHost||p.network_kind!=='cloud_engine'||p.deployment_id!==config.environment||p.additional_subnets_enabled||!eq(p.primary_subnet,config.subnetId)||p.approved_subnets.length!==1||!eq(p.approved_subnets[0],config.subnetId)||live.domains.length!==domains.length||p.domains.length!==domains.length||domains.some(([k,v])=>!live.domains.some(d=>d.domain===k&&eq(d.canister,v))||!p.domains.some(d=>d.domain===k&&eq(d.canister,v)&&eq(d.subnet,config.subnetId))))throw Error('Group mismatch '+name);
}

const base=page.groups.find(g=>g.id==='base');
if(router!=='htjgq-diaaa-aaac5-aadrq-cai'||base.heap_budget_bytes!==BigInt(config.groups[0].heapBudgetBytes))throw Error('Unexpected base configuration');
const Mem=R({heap_bytes:I.Nat,memory_bytes:I.Nat,stable_bytes:I.Nat});
let heap=0n,cycles=null;
for(const canister of Object.values(config.groups[0].canisterIds)){
 const actor=Actor.createActor(()=>I.Service({memory_stats:I.Func([],[Mem],['query']),cycles_balance:I.Func([],[I.Nat],['query'])}),{agent,canisterId:canister});
 const [mem,c]=await Promise.all([actor.memory_stats(),actor.cycles_balance()]);
 if(mem.heap_bytes>heap)heap=mem.heap_bytes;if(cycles===null||c<cycles)cycles=c;
}
if(heap>=base.heap_budget_bytes||base.assigned_clubs>=base.max_clubs)throw Error('No capacity');
console.log('Measured group heap '+heap+'; minimum cycles '+cycles);
if(mode==='check')process.exit(0);
await invoke(router,'record_group_health',[T,N,N,N],['base',heap,cycles,page.revision],N);
if(!base.accepting){
 const revision=await invoke(router,'register_group',[Group,N],[{...base,accepting:true},page.revision],N);
 if(revision!==page.revision+1n)throw Error('Unexpected opening revision');
}
const after=await invoke(router,'read_group_registry_page',[T,I.Opt(N),I.Opt(T),I.Nat32],['opencloud-dev',[],[],64],Page);
if(after.groups.length!==2||!after.groups.find(g=>g.id==='base')?.accepting||after.groups.find(g=>g.id==='g2')?.accepting!==false)throw Error('Opening readback failed');
console.log('Group 1 accepting; Group 2 closed');
