import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { identityFromPem } from '../prod-connection-check.mjs';
import { MANAGEMENT_PROXY } from './dev-auto.mjs';
import { validate } from './deployment.mjs';
const [work, mode, originalWork] = process.argv.slice(2);
if (!['check','upgrade'].includes(mode)) throw Error('Explicit mode required');
const config = JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const peer = JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
if(process.env.GITHUB_REF_NAME!=='prod'||config.environment!=='opencloud-prod'||config.applicationKey!=='ignite_prod_v2'||config.operatorId!==MANAGEMENT_PROXY||config.apiHost!=='https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net') throw Error('Wrong PROD target');
const rows = validate({...config,supabase:{...config.supabase,publishableKey:config.supabase.publishableKey||'sb_publishable_OFFLINE_INSTALL_VALIDATION'}},peer);
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

const original=JSON.parse(fs.readFileSync(path.join(originalWork,'manifest.json')));
if(original.environment!=='opencloud-prod'||original.applicationKey!==config.applicationKey||original.engine.operatorId!==MANAGEMENT_PROXY) throw Error('Wrong original manifest');
const pins={g1_timer_jobs:'gixkr-vqaaa-aaac5-aaeiq-cai',g2_timer_jobs:'hfzo7-2yaaa-aaac5-aaepa-cai'};
if(config.controllers.governor!=='kydv5-mptl2-ip3ie-5zwd3-gc5en-4opnd-mytmr-gza6m-xh5t4-jz662-7ae') throw Error('Wrong pinned governor');
const targets=Object.entries(pins).map(([name,id])=>{
 const r=rows.find(x=>x.name===name), a=m.canisters.find(x=>x.name===name), o=original.canisters.find(x=>x.name===name);
 if(!r||!a||!o||[r,a,o].some(x=>x.id!==id||x.service!=='timer_jobs')) throw Error('Timer inventory mismatch');
 const gz=fs.readFileSync(path.join(work,a.wasm)), wasm=gunzipSync(gz);
 const oldGz=fs.readFileSync(path.join(originalWork,o.wasm));
 if(hash(gz)!==a.wasmSha256||hash(wasm)!==a.moduleSha256||hash(oldGz)!==o.wasmSha256||hash(gunzipSync(oldGz))!==o.moduleSha256||o.moduleSha256===a.moduleSha256) throw Error('Artifact mismatch');
 return {...a,wasm,oldHash:o.moduleSha256};
});
const read=async t=>{
 const {spawnSync}=await import('node:child_process');
 const r=spawnSync('icp',['canister','call',t.id,'read_group_opening_configuration','()','--candid',path.resolve('backend/timer_jobs/timer_jobs.did'),'--network','ic','--identity','opencloud-governor'],{encoding:'utf8',cwd:process.env.RUNNER_TEMP});
 if(r.status!==0) throw Error('Readback transport failed '+t.name);
 console.log(t.name+' readback: '+r.stdout);
 return r.stdout;
};
const readPublic=async(t,method)=>{
 const {spawnSync}=await import('node:child_process');
 const r=spawnSync('icp',['canister','call',t.id,method,'()','--candid',path.resolve('backend/timer_jobs/timer_jobs.did'),'--network','ic','--identity','opencloud-governor'],{encoding:'utf8',cwd:process.env.RUNNER_TEMP});
 if(r.status!==0) throw Error('Readback transport failed '+t.name+' '+method);
 console.log(t.name+' '+method+': '+r.stdout);
 return r.stdout.trim();
};
const pristinePublic=async t=>{
 const state=await readPublic(t,'get_state');
 if(!/\barmed\s*=\s*false\b/.test(state)||!/\bnext_run_at_ms\s*=\s*null\b/.test(state)) throw Error('Timer not pristine '+t.name);
 const authority=await readPublic(t,'read_account_removal_authority');
 if(!/^\(\s*null\s*,?\s*\)$/.test(authority)) throw Error('Removal authority not empty '+t.name);
};
const verify=async(t,h)=>{const s=await status(t.id);verifyControllers(s);if(Buffer.from(s.module_hash[0]??[]).toString('hex')!==h)throw Error('Module mismatch '+t.name);return s;};
for(const t of targets){await verify(t,t.oldHash);await pristinePublic(t);const out=await read(t);if(!/Governor required/.test(out)||!/\bErr\b/.test(out))throw Error('Unexpected original authority response '+t.name);console.log('Verified original module '+t.name+' '+t.oldHash);}
if(mode==='check')process.exit(0);
if(process.env.APPROVE_TIMER_UPGRADE!=='YES')throw Error('Explicit upgrade approval required');
for(const t of targets){
 await verify(t,t.oldHash);
 await pristinePublic(t);
 const chunks=[];
 await call('clear_chunk_store',Target,{canister_id:pid(t.id)});
 for(let i=0;i<t.wasm.length;i+=1000000){const chunk=t.wasm.subarray(i,i+1000000);const [r]=await call('upload_chunk',I.Record({canister_id:P,chunk:B}),{canister_id:pid(t.id),chunk},[I.Record({hash:B})]);if(Buffer.from(r.hash).toString('hex')!==hash(chunk))throw Error('Chunk mismatch');chunks.push({hash:r.hash});}
 await call('install_chunked_code',I.Record({mode:I.Variant({upgrade:I.Opt(I.Record({skip_pre_upgrade:I.Opt(I.Bool)}))}),target_canister:P,store_canister:I.Opt(P),chunk_hashes_list:I.Vec(I.Record({hash:B})),wasm_module_hash:B,arg:B,sender_canister_version:I.Opt(I.Nat64)}),{mode:{upgrade:[]},target_canister:pid(t.id),store_canister:[],chunk_hashes_list:chunks,wasm_module_hash:Buffer.from(t.moduleSha256,'hex'),arg:new Uint8Array(I.encode([],[])),sender_canister_version:[]});
 await verify(t,t.moduleSha256);
 const out=await read(t);if(!/\bOk\b/.test(out)||/\bErr\b/.test(out))throw Error('Governor readback failed '+t.name);
 console.log('Upgraded and verified '+t.name);
}
