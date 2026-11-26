import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { identityFromPem } from '../prod-connection-check.mjs';
import { guard, activation, MANAGEMENT_PROXY } from './dev-auto.mjs';
const [work, mode] = process.argv.slice(2);
if (!['check','install'].includes(mode)) throw Error('Explicit mode required');
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
const expected=[MANAGEMENT_PROXY,config.controllers.owner,config.controllers.connectedIdentity,config.controllers.governor].sort();
const verifyControllers=s=>{if(JSON.stringify(s.settings.controllers.map(p=>p.toText()).sort())!==JSON.stringify(expected))throw Error('Controller mismatch');};
const targets=m.installOrder.filter(n=>n!=='frontend').map(n=>{const r=rows.find(x=>x.name===n),a=m.canisters.find(x=>x.name===n);if(!r||!a||r.id!==a.id||r.service!==a.service)throw Error('Manifest mismatch '+n);const gz=fs.readFileSync(path.join(work,a.wasm)),wasm=gunzipSync(gz);if(hash(gz)!==a.wasmSha256||hash(wasm)!==a.moduleSha256)throw Error('Artifact mismatch '+n);const g=config.controllers.governor;let arg;if(a.initArgs==='()')arg=I.encode([],[]);else if(a.initArgs===`(principal "${g}")`)arg=I.encode([P],[pid(g)]);else if(a.initArgs===`(record { governor = principal "${g}" })`)arg=I.encode([I.Record({governor:P})],[{governor:pid(g)}]);else throw Error('Unknown constructor '+n+': '+a.initArgs);return {...a,wasm,arg};});
if(targets.length!==31||new Set(targets.map(t=>t.id)).size!==31)throw Error('Wrong targets');
for(const t of targets){const s=await status(t.id);verifyControllers(s);if(s.module_hash.length)throw Error('Nonempty target '+t.name);console.log('Empty and authorized: '+t.name);}
if(mode==='check'){console.log('Read-only check complete');process.exit(0);}
for(const t of targets){
 const s=await status(t.id);verifyControllers(s);if(s.module_hash.length)throw Error('Nonempty target '+t.name);
 const vars=new Map(s.settings.environment_variables.map(v=>[v.name,v.value]));for(const [k,v] of Object.entries(t.settings.environmentVariables))vars.set(k,v);
 const env=[...vars].map(([name,value])=>({name,value}));const limit=BigInt(t.settings.wasmMemoryLimit);
 await call('update_settings',I.Record({canister_id:P,settings:I.Record({environment_variables:I.Opt(E),wasm_memory_limit:I.Opt(I.Nat)})}),{canister_id:pid(t.id),settings:{environment_variables:[env],wasm_memory_limit:[limit]}});
 const check=async()=>{const a=await status(t.id);verifyControllers(a);const v=new Map(a.settings.environment_variables.map(x=>[x.name,x.value]));if(a.settings.wasm_memory_limit!==limit||env.some(x=>v.get(x.name)!==x.value))throw Error('Settings mismatch '+t.name);return a;};
 if((await check()).module_hash.length)throw Error('Target no longer empty');
 const chunks=[];await call('clear_chunk_store',Target,{canister_id:pid(t.id)});
 for(let i=0;i<t.wasm.length;i+=1000000){const chunk=t.wasm.subarray(i,i+1000000);const [r]=await call('upload_chunk',I.Record({canister_id:P,chunk:B}),{canister_id:pid(t.id),chunk},[I.Record({hash:B})]);if(Buffer.from(r.hash).toString('hex')!==hash(chunk))throw Error('Chunk mismatch');chunks.push({hash:r.hash});}
 await call('install_chunked_code',I.Record({mode:I.Variant({install:I.Null}),target_canister:P,store_canister:I.Opt(P),chunk_hashes_list:I.Vec(I.Record({hash:B})),wasm_module_hash:B,arg:B,sender_canister_version:I.Opt(I.Nat64)}),{mode:{install:null},target_canister:pid(t.id),store_canister:[],chunk_hashes_list:chunks,wasm_module_hash:Buffer.from(t.moduleSha256,'hex'),arg:new Uint8Array(t.arg),sender_canister_version:[]});
 const after=await check();if(Buffer.from(after.module_hash[0]??[]).toString('hex')!==t.moduleSha256)throw Error('Installed hash mismatch '+t.name);console.log('Installed and verified '+t.name);
}
