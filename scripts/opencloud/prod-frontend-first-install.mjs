import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { identityFromPem } from '../prod-connection-check.mjs';
import { MANAGEMENT_PROXY } from './dev-auto.mjs';
import { validate } from './deployment.mjs';
const [wasmFile, mode] = process.argv.slice(2);
if (!['check','install'].includes(mode)) throw Error('Explicit mode required');
const config = JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const peer = JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
if(process.env.GITHUB_REF_NAME!=='main'||config.environment!=='opencloud-prod'||config.applicationKey!=='ignite_prod_v2'||config.operatorId!==MANAGEMENT_PROXY||config.apiHost!=='https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net') throw Error('Wrong PROD target');
if(process.env.OPENCLOUD_PROD_AUTO_DEPLOY==='true'||process.env.OPENCLOUD_PROD_FRONTEND_READY==='true') throw Error('Activation must remain off');
const rows = validate({...config,supabase:{...config.supabase,publishableKey:config.supabase.publishableKey||'sb_publishable_OFFLINE_INSTALL_VALIDATION'}},peer);
const require = createRequire(path.resolve('frontend/package.json'));
const {HttpAgent,Actor}=require('@icp-sdk/core/agent');
const {IDL:I}=require('@icp-sdk/core/candid');
const {Principal}=require('@icp-sdk/core/principal');
const {Ed25519KeyIdentity}=require('@icp-sdk/core/identity');
const {Secp256k1KeyIdentity}=require('@icp-sdk/core/identity/secp256k1');
const identity=identityFromPem(fs.readFileSync(process.env.PUBLISHER_PEM_FILE,'utf8'),{Ed25519KeyIdentity,Secp256k1KeyIdentity});
if(identity.getPrincipal().toText()!==config.controllers.frontendPublisher) throw Error('Wrong publisher');
const agent=await HttpAgent.create({host:config.apiHost,identity,shouldFetchRootKey:false});
const B=I.Vec(I.Nat8), P=I.Principal, E=I.Vec(I.Record({name:I.Text,value:I.Text}));
const proxy=Actor.createActor(()=>I.Service({proxy:I.Func([I.Record({method:I.Text,args:B,canister_id:P,cycles:I.Nat})],[I.Variant({Ok:I.Record({result:B}),Err:I.Variant({CallFailed:I.Record({reason:I.Text}),InsufficientCycles:I.Record({available:I.Nat,required:I.Nat}),UnauthorizedUser:I.Null})})],[])}),{agent,canisterId:MANAGEMENT_PROXY});
const pid = text => Principal.fromText(text);
const call=async(method,type,arg,returns=[])=>{const r=await proxy.proxy({method,args:new Uint8Array(I.encode([type],[arg])),canister_id:pid('aaaaa-aa'),cycles:0n});if(!('Ok' in r))throw Error('Proxy refused '+method);return I.decode(returns,Uint8Array.from(r.Ok.result));};
const Target=I.Record({canister_id:P});
const Status=I.Record({module_hash:I.Opt(B),settings:I.Record({controllers:I.Vec(P),environment_variables:E,wasm_memory_limit:I.Nat})});
const status=async id=>(await call('canister_status',Target,{canister_id:pid(id)},[Status]))[0];
const hash=b=>createHash('sha256').update(b).digest('hex');
const expected=[MANAGEMENT_PROXY,config.controllers.owner,config.controllers.connectedIdentity,config.controllers.frontendPublisher].sort();
const verifyControllers=s=>{if(JSON.stringify(s.settings.controllers.map(p=>p.toText()).sort())!==JSON.stringify(expected))throw Error('Controller mismatch');};

const id='f7fgd-eiaaa-aaac5-aaeaa-cai';
if(config.shared.frontend!==id||!rows.some(r=>r.service==='frontend'&&r.id===id))throw Error('Wrong frontend target');
const bytes=fs.readFileSync(wasmFile);
const wasm=bytes[0]===31&&bytes[1]===139?gunzipSync(bytes):bytes;
const digest='88fb9e040e1413ac90415ac1082fe11266e494b2a78d7d69ae29703523ee2415';
if(hash(wasm)!==digest)throw Error('Unexpected static-site v0.4.0 module');
const before=await status(id);verifyControllers(before);
if(before.module_hash.length){
 if(Buffer.from(before.module_hash[0]).toString('hex')!==digest)throw Error('Unexpected installed module');
 console.log('Expected frontend already installed; no reinstall');process.exit(0);
}
if(mode==='check'){console.log('PROD frontend is empty and controllers verified');process.exit(0);}
const chunks=[];
await call('clear_chunk_store',Target,{canister_id:pid(id)});
for(let i=0;i<wasm.length;i+=1000000){const chunk=wasm.subarray(i,i+1000000);const [r]=await call('upload_chunk',I.Record({canister_id:P,chunk:B}),{canister_id:pid(id),chunk},[I.Record({hash:B})]);if(Buffer.from(r.hash).toString('hex')!==hash(chunk))throw Error('Chunk mismatch');chunks.push({hash:r.hash});}
const latest=await status(id);verifyControllers(latest);if(latest.module_hash.length)throw Error('Target no longer empty');
await call('install_chunked_code',I.Record({mode:I.Variant({install:I.Null}),target_canister:P,store_canister:I.Opt(P),chunk_hashes_list:I.Vec(I.Record({hash:B})),wasm_module_hash:B,arg:B,sender_canister_version:I.Opt(I.Nat64)}),{mode:{install:null},target_canister:pid(id),store_canister:[],chunk_hashes_list:chunks,wasm_module_hash:Buffer.from(digest,'hex'),arg:I.encode([],[]),sender_canister_version:[]});
const after=await status(id);verifyControllers(after);if(Buffer.from(after.module_hash[0]??[]).toString('hex')!==digest)throw Error('Installed hash mismatch');
console.log('Installed exact PROD static-site module');
