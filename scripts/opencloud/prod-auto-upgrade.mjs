import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { identityFromPem } from '../prod-connection-check.mjs';
import { plan, MANAGEMENT_PROXY } from './dev-auto.mjs';
import { validateMappings } from './deployment.mjs';
import { spawnSync } from 'node:child_process';
const [beforeRef, afterRef, work] = process.argv.slice(2);

const config = JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const peer = JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
if(process.env.GITHUB_REF_NAME!=='prod'||config.environment!=='opencloud-prod'||config.applicationKey!=='ignite_prod_v2'||config.operatorId!==MANAGEMENT_PROXY) throw Error('Wrong PROD target');
const rows=validateMappings(config,peer);
if(rows.length!==32||rows.some(r=>!r.id))throw Error('Incomplete PROD inventory');
if(process.env.OPENCLOUD_PROD_AUTO_DEPLOY!=='true')throw Error('Automatic deployment disabled');
const m = JSON.parse(fs.readFileSync(path.join(work,'manifest.json')));
if(m.environment!=='opencloud-prod'||m.applicationKey!=='ignite_prod_v2'||m.canisters.length!==32||m.engine.operatorId!==MANAGEMENT_PROXY) throw Error('Wrong manifest');
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
const expected=[MANAGEMENT_PROXY,config.controllers.owner,config.controllers.connectedIdentity,config.controllers.governor].sort();
const verifyControllers=s=>{if(JSON.stringify(s.settings.controllers.map(p=>p.toText()).sort())!==JSON.stringify(expected))throw Error('Controller mismatch');};

// Preflight all secure-name targets before any mutation.
const repairs=new Map();
const nameTargets=rows.filter(r=>['identity_access','pii_access_control'].includes(r.service));
const g1=config.groups.find(g=>g.id==='g1');
if(nameTargets.length!==3||!g1?.canisterIds?.pii_access_control)throw Error('Incomplete secure-name inventory');
for(const t of nameTargets){
 const live=await status(t.id);verifyControllers(live);
 if(!live.module_hash.length)throw Error('Missing installed module '+t.name);
 const vars=new Map(live.settings.environment_variables.map(v=>[v.name,v.value]));
 const desired=t.service==='identity_access'
  ? {IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE:'1',IGNITE_SECURE_ADULT_NAME_PII:g1.canisterIds.pii_access_control}
  : {IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE:'1',IGNITE_SECURE_ADULT_NAME_IDENTITY:config.shared.identity_access};
 for(const [key,value] of Object.entries(desired)){
  const state=!vars.has(key)?'missing':vars.get(key)===value?'correct':'different';
  console.log('Secure-name settings '+t.name+' '+key+': '+state);
  if(state==='different')throw Error('Conflicting secure-name setting '+t.name+' '+key);
  if(state==='missing')repairs.set(t.id,desired);
 }
}

if(!/^[a-f0-9]{40}$/.test(beforeRef)||! /^[a-f0-9]{40}$/.test(afterRef)||/^0+$/.test(beforeRef)||afterRef!==process.env.GITHUB_SHA)throw Error('Explicit commit range required');
const diff=spawnSync('git',['diff','--name-only',beforeRef,afterRef],{encoding:'utf8'});if(diff.status!==0)throw Error('Cannot determine changes');
const planned=plan(rows,diff.stdout.split('\n').filter(Boolean)).targets;
for(const t of nameTargets)if(repairs.has(t.id)&&!planned.some(x=>x.id===t.id))planned.push(t);
const targets=planned.sort((a,b)=>Number(a.service==='identity_access')-Number(b.service==='identity_access')).map(t=>{
 const r=rows.find(x=>x.name===t.name&&x.id===t.id&&x.service===t.service&&x.scope===t.scope);
 const a=m.canisters.find(x=>x.name===t.name&&x.id===t.id&&x.service===t.service);
 if(!r||!a||r.service==='frontend')throw Error('Wrong target');
 const gz=fs.readFileSync(path.join(work,a.wasm)),wasm=gunzipSync(gz);
 if(hash(gz)!==a.wasmSha256||hash(wasm)!==a.moduleSha256)throw Error('Artifact mismatch '+r.name);
 const g=config.controllers.governor;let arg;
 if(a.initArgs==='()')arg=I.encode([],[]);
 else if(a.initArgs===`(principal "${g}")`)arg=I.encode([P],[pid(g)]);
 else if(a.initArgs===`(record { governor = principal "${g}" })`)arg=I.encode([I.Record({governor:P})],[{governor:pid(g)}]);
 else throw Error('Unknown constructor');
 return {...a,wasm,arg};
});
if(new Set(targets.map(t=>t.id)).size!==targets.length)throw Error('Duplicate targets');
const moduleHash=s=>Buffer.from(s.module_hash[0]??[]).toString('hex');
const settings=s=>JSON.stringify({controllers:s.settings.controllers.map(p=>p.toText()).sort(),env:s.settings.environment_variables.map(v=>[v.name,v.value]).sort(),limit:String(s.settings.wasm_memory_limit)});
const before=new Map();
for(const t of targets){const s=await status(t.id);verifyControllers(s);if(!moduleHash(s))throw Error('Empty target '+t.name);before.set(t.id,s);if(repairs.has(t.id)&&t.upgradePersistence!=='keep')throw Error('Secure-name repair requires keep persistence '+t.name);}
const Upgrade=I.Record({skip_pre_upgrade:I.Opt(I.Bool),wasm_memory_persistence:I.Opt(I.Variant({keep:I.Null,replace:I.Null}))});
for(const t of targets){
 let old=before.get(t.id);
 const repair=repairs.get(t.id);
 if(repair){
  const live=await status(t.id);verifyControllers(live);
  if(settings(live)!==settings(old)||moduleHash(live)!==moduleHash(old))throw Error('Concurrent settings change '+t.name);
  const vars=new Map(live.settings.environment_variables.map(v=>[v.name,v.value]));
  for(const [k,v] of Object.entries(repair)){if(vars.has(k)&&vars.get(k)!==v)throw Error('Conflicting secure-name setting');vars.set(k,v);}
  const env=[...vars].map(([name,value])=>({name,value}));
  await call('update_settings',I.Record({canister_id:P,settings:I.Record({environment_variables:I.Opt(E)})}),{canister_id:pid(t.id),settings:{environment_variables:[env]}});
  const after=await status(t.id);verifyControllers(after);
  const actual=new Map(after.settings.environment_variables.map(v=>[v.name,v.value]));
  if(actual.size!==vars.size||env.some(x=>actual.get(x.name)!==x.value)||moduleHash(after)!==moduleHash(old)||after.settings.wasm_memory_limit!==old.settings.wasm_memory_limit)throw Error('Secure-name settings readback mismatch');
  old=after;
 }
 if(!repair&&moduleHash(old)===t.moduleSha256){console.log('Unchanged '+t.name);continue;}
 const check=async()=>{const s=await status(t.id);verifyControllers(s);if(settings(s)!==settings(old))throw Error('Settings changed '+t.name);return s;};
 if(moduleHash(await check())!==moduleHash(old))throw Error('Concurrent module change');
 const chunks=[];await call('clear_chunk_store',Target,{canister_id:pid(t.id)});
 for(let i=0;i<t.wasm.length;i+=1000000){const chunk=t.wasm.subarray(i,i+1000000);const [r]=await call('upload_chunk',I.Record({canister_id:P,chunk:B}),{canister_id:pid(t.id),chunk},[I.Record({hash:B})]);if(Buffer.from(r.hash).toString('hex')!==hash(chunk))throw Error('Chunk mismatch');chunks.push({hash:r.hash});}
 if(moduleHash(await check())!==moduleHash(old))throw Error('Concurrent module change');
 await call('install_chunked_code',I.Record({mode:I.Variant({upgrade:I.Opt(Upgrade)}),target_canister:P,store_canister:I.Opt(P),chunk_hashes_list:I.Vec(I.Record({hash:B})),wasm_module_hash:B,arg:B,sender_canister_version:I.Opt(I.Nat64)}),{mode:{upgrade:[{skip_pre_upgrade:[false],wasm_memory_persistence:t.upgradePersistence==='keep'?[{keep:null}]:[]}]},target_canister:pid(t.id),store_canister:[],chunk_hashes_list:chunks,wasm_module_hash:Buffer.from(t.moduleSha256,'hex'),arg:new Uint8Array(t.arg),sender_canister_version:[]});
 if(moduleHash(await check())!==t.moduleSha256)throw Error('Upgrade hash mismatch '+t.name);
 console.log('Upgraded and verified '+t.name);
}
