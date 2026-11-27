import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { identityFromPem } from '../prod-connection-check.mjs';
import { MANAGEMENT_PROXY } from './dev-auto.mjs';
import { validate } from './deployment.mjs';
const config = JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const peer = JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
if(process.env.GITHUB_REF_NAME!=='prod'||config.environment!=='opencloud-prod'||config.applicationKey!=='ignite_prod_v2'||config.operatorId!==MANAGEMENT_PROXY||config.apiHost!=='https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net') throw Error('Wrong PROD target');
const rows = validate({...config,supabase:{...config.supabase,publishableKey:config.supabase.publishableKey||'sb_publishable_OFFLINE_INSTALL_VALIDATION'}},peer);
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


const identityId='fyeax-jqaaa-aaac5-aaeaq-cai';
const release='IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE';
const pii={ [release]:'1',IGNITE_PRIVATE_PROFILE_IDENTITY:identityId,IGNITE_SHARED_CLUB_NAME_ENFORCEMENT_RELEASE:'1',IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE:'1',IGNITE_SECURE_ADULT_NAME_IDENTITY:identityId };
const targets=[
 ['g1_pii_access_control','gpwmf-yiaaa-aaac5-aaeia-cai',pii,true],
 ['g2_pii_access_control','hm2fd-mqaaa-aaac5-aaeoq-cai',pii,true],
 ['identity_access',identityId,{[release]:'1',IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE:'1',IGNITE_SECURE_ADULT_NAME_PII:'gpwmf-yiaaa-aaac5-aaeia-cai'},false],
 ['g1_club_domain','fndr2-iyaaa-aaac5-aaeda-cai',{[release]:'1'},false],
 ['g2_club_domain','ggvhz-oaaaa-aaac5-aaejq-cai',{[release]:'1'},false]
];
const forbidden=['IGNITE_DEV_G2_SHARED_CLUB_NAMES_RELEASE','IGNITE_DEV_LEGACY_G1_TEAM_NAME_RELEASE','IGNITE_DEV_LEGACY_G1_OBSERVED_KEY_SHA256'];

const [work,mode]=process.argv.slice(2);
if(!['check','apply'].includes(mode))throw Error('Explicit mode required');
const m=JSON.parse(fs.readFileSync(path.join(work,'manifest.json')));
if(m.environment!=='opencloud-prod'||m.applicationKey!=='ignite_prod_v2'||m.engine.operatorId!==MANAGEMENT_PROXY||m.canisters.length!==32)throw Error('Wrong manifest');
const pins={g1_pii_access_control:'3742ea1edc52245445b945d58a63b612182aa9b6954df1f7bbe41da0d6745587',g2_pii_access_control:'3742ea1edc52245445b945d58a63b612182aa9b6954df1f7bbe41da0d6745587',identity_access:'385f83a3d7e1fbad5426c1121bc07008cb86b925ed695cb40052d9b5e7648b80',g1_club_domain:'e55b66bf5d52dfd1fe3ab3dd3dfd883e8467cf3309a637116b38d9bdb51de198',g2_club_domain:'e55b66bf5d52dfd1fe3ab3dd3dfd883e8467cf3309a637116b38d9bdb51de198'};
const repairs=new Map(),before=new Map(),prepared=[];
const moduleHash=s=>Buffer.from(s.module_hash[0]??[]).toString('hex');
const settings=s=>JSON.stringify({controllers:s.settings.controllers.map(p=>p.toText()).sort(),env:s.settings.environment_variables.map(v=>[v.name,v.value]).sort(),limit:String(s.settings.wasm_memory_limit)});
for(const [name,id,desired,isPii] of targets){
 const r=rows.find(x=>x.name===name&&x.id===id),a=m.canisters.find(x=>x.name===name&&x.id===id);
 if(!r||!a||a.service!==r.service)throw Error('Inventory mismatch '+name);
 const live=await status(id);verifyControllers(live);
 const vars=new Map(live.settings.environment_variables.map(v=>[v.name,v.value]));
 if(vars.size!==live.settings.environment_variables.length||forbidden.some(k=>vars.has(k))||isPii&&(vars.get('VETKD_KEY_NAME')!=='key_1'||vars.get('IGNITE_SECURE_ADULT_NAME_IDENTITY')!==identityId))throw Error('Prerequisite failed '+name);
 for(const [k,v] of Object.entries(desired))if(vars.has(k)&&vars.get(k)!==v)throw Error('Conflicting setting '+name+' '+k);
 const gz=fs.readFileSync(path.join(work,a.wasm)),wasm=gunzipSync(gz);
 if(moduleHash(live)!==pins[name]||a.moduleSha256!==pins[name]||hash(wasm)!==pins[name]||hash(gz)!==a.wasmSha256)throw Error('Exact live artifact mismatch '+name+' live='+moduleHash(live)+' candidate='+a.moduleSha256);
 if(r.service!=='identity_access'&&a.upgradePersistence!=='keep')throw Error('Keep persistence required '+name);
 const g=config.controllers.governor;let arg;
 if(a.initArgs==='()')arg=I.encode([],[]);
 else if(a.initArgs===`(principal "${g}")`)arg=I.encode([P],[pid(g)]);
 else if(a.initArgs===`(record { governor = principal "${g}" })`)arg=I.encode([I.Record({governor:P})],[{governor:pid(g)}]);
 else throw Error('Unknown constructor '+name);
 before.set(id,live);repairs.set(id,desired);prepared.push({...a,wasm,arg});
 console.log(JSON.stringify({name,id,moduleHash:moduleHash(live),missing:Object.keys(desired).filter(k=>!vars.has(k)),environmentDigest:hash(settings(live))}));
}
if(mode==='check'){console.log('All five exact artifacts verified; no writes');process.exit(0);}
if(process.env.APPROVE_PRIVATE_NAME_REPAIR!=='YES')throw Error('Explicit approval required');
const Upgrade=I.Record({skip_pre_upgrade:I.Opt(I.Bool),wasm_memory_persistence:I.Opt(I.Variant({keep:I.Null,replace:I.Null}))});
for(const t of prepared){
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

 const check=async()=>{const s=await status(t.id);verifyControllers(s);if(settings(s)!==settings(old))throw Error('Settings changed '+t.name);return s;};
 if(moduleHash(await check())!==moduleHash(old))throw Error('Concurrent module change');
 const chunks=[];await call('clear_chunk_store',Target,{canister_id:pid(t.id)});
 for(let i=0;i<t.wasm.length;i+=1000000){const chunk=t.wasm.subarray(i,i+1000000);const [r]=await call('upload_chunk',I.Record({canister_id:P,chunk:B}),{canister_id:pid(t.id),chunk},[I.Record({hash:B})]);if(Buffer.from(r.hash).toString('hex')!==hash(chunk))throw Error('Chunk mismatch');chunks.push({hash:r.hash});}
 if(moduleHash(await check())!==moduleHash(old))throw Error('Concurrent module change');
 await call('install_chunked_code',I.Record({mode:I.Variant({upgrade:I.Opt(Upgrade)}),target_canister:P,store_canister:I.Opt(P),chunk_hashes_list:I.Vec(I.Record({hash:B})),wasm_module_hash:B,arg:B,sender_canister_version:I.Opt(I.Nat64)}),{mode:{upgrade:[{skip_pre_upgrade:[false],wasm_memory_persistence:t.upgradePersistence==='keep'?[{keep:null}]:[]}]},target_canister:pid(t.id),store_canister:[],chunk_hashes_list:chunks,wasm_module_hash:Buffer.from(t.moduleSha256,'hex'),arg:new Uint8Array(t.arg),sender_canister_version:[]});
 if(moduleHash(await check())!==t.moduleSha256)throw Error('Upgrade hash mismatch '+t.name);
 console.log(JSON.stringify({name:t.name,beforeHash:t.moduleSha256,afterHash:moduleHash(await check()),environmentDigest:hash(settings(await check())),settings:Object.keys(repair)}));
}
