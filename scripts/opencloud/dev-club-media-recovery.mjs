import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { identityFromPem } from '../prod-connection-check.mjs';
import { guard, activation, MANAGEMENT_PROXY } from './dev-auto.mjs';
const [work, originalWork, mode] = process.argv.slice(2);
if (!['check','upgrade'].includes(mode)) throw Error('Explicit mode required');
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
const call=async(method,type,arg,returns=[])=>{const r=await proxy.proxy({method,args:new Uint8Array(I.encode([type],[arg])),canister_id:pid('aaaaa-aa'),cycles:0n});if(!('Ok' in r))throw Error('Proxy refused '+method+': '+JSON.stringify(r.Err,(_key,value)=>typeof value==='bigint'?value.toString():value));return I.decode(returns,Uint8Array.from(r.Ok.result));};
const Target=I.Record({canister_id:P});
const Status=I.Record({module_hash:I.Opt(B),settings:I.Record({controllers:I.Vec(P),environment_variables:E,wasm_memory_limit:I.Nat})});
const status=async id=>(await call('canister_status',Target,{canister_id:pid(id)},[Status]))[0];
const hash=b=>createHash('sha256').update(b).digest('hex');
const expected=[MANAGEMENT_PROXY,config.controllers.owner,config.controllers.connectedIdentity,config.controllers.governor].sort();
const verifyControllers=s=>{if(JSON.stringify(s.settings.controllers.map(p=>p.toText()).sort())!==JSON.stringify(expected))throw Error('Controller mismatch');};
const original=JSON.parse(fs.readFileSync(path.join(originalWork,'manifest.json')));
const ids=['him2v-zqaaa-aaac5-aadta-cai','ed2mw-7iaaa-aaac5-aadzq-cai'];
const targets=ids.map(id=>{const r=rows.find(x=>x.id===id),a=m.canisters.find(x=>x.id===id);if(r?.service!=='club_domain'||a?.service!=='club_domain')throw Error('Wrong club target');const gz=fs.readFileSync(path.join(work,a.wasm)),wasm=gunzipSync(gz);if(hash(gz)!==a.wasmSha256||hash(wasm)!==a.moduleSha256)throw Error('Artifact mismatch');return {...a,wasm,arg:I.encode([P],[pid(config.controllers.governor)])};});
for(const t of targets){const s=await status(t.id);verifyControllers(s);if(!s.module_hash.length||![t.moduleSha256,original.canisters.find(a=>a.id===t.id)?.moduleSha256].includes(Buffer.from(s.module_hash[0]).toString('hex')))throw Error('Unexpected club module');console.log(t.name+' current hash '+Buffer.from(s.module_hash[0]).toString('hex'));}
if(mode==='check')process.exit(0);
for(const t of targets){
 const s=await status(t.id);verifyControllers(s);if(!s.module_hash.length||![t.moduleSha256,original.canisters.find(a=>a.id===t.id)?.moduleSha256].includes(Buffer.from(s.module_hash[0]).toString('hex')))throw Error('Unexpected club module');
 if(Buffer.from(s.module_hash[0]).toString('hex')!==t.moduleSha256){
 const chunks=[];await call('clear_chunk_store',Target,{canister_id:pid(t.id)});
 for(let i=0;i<t.wasm.length;i+=1000000){const chunk=t.wasm.subarray(i,i+1000000);const [r]=await call('upload_chunk',I.Record({canister_id:P,chunk:B}),{canister_id:pid(t.id),chunk},[I.Record({hash:B})]);if(Buffer.from(r.hash).toString('hex')!==hash(chunk))throw Error('Chunk mismatch');chunks.push({hash:r.hash});}
 await call('install_chunked_code',I.Record({mode:I.Variant({upgrade:I.Opt(I.Record({skip_pre_upgrade:I.Opt(I.Bool),wasm_memory_persistence:I.Opt(I.Variant({keep:I.Null,replace:I.Null}))}))}),target_canister:P,store_canister:I.Opt(P),chunk_hashes_list:I.Vec(I.Record({hash:B})),wasm_module_hash:B,arg:B,sender_canister_version:I.Opt(I.Nat64)}),{mode:{upgrade:[{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}]},target_canister:pid(t.id),store_canister:[],chunk_hashes_list:chunks,wasm_module_hash:Buffer.from(t.moduleSha256,'hex'),arg:new Uint8Array(t.arg),sender_canister_version:[]});
 }
 const after=await status(t.id);verifyControllers(after);if(Buffer.from(after.module_hash[0]??[]).toString('hex')!==t.moduleSha256)throw Error('Hash mismatch');
 const timer=Actor.createActor(()=>I.Service({read_media_quota_store_registry:I.Func([],[I.Variant({Ok:I.Record({active:I.Bool,stores:I.Vec(P)}),Err:I.Text})],[])}),{agent,canisterId:t.id});
 const result=await timer.read_media_quota_store_registry();if(!('Ok' in result))throw Error('Governor readback refused '+JSON.stringify(result));console.log('Verified club media registry '+t.name);
}
