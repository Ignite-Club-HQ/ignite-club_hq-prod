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
let failed=false;
for(const [name,id,desired,isPii] of targets){
 if(!rows.some(r=>r.name===name&&r.id===id))throw Error('Inventory mismatch '+name);
 const s=await status(id);verifyControllers(s);
 const env=new Map(s.settings.environment_variables.map(x=>[x.name,x.value]));
 if(env.size!==s.settings.environment_variables.length||!s.module_hash[0])throw Error('Invalid status '+name);
 const prerequisites=!isPii||(env.get('VETKD_KEY_NAME')==='key_1'&&env.get('IGNITE_SECURE_ADULT_NAME_IDENTITY')===identityId);
 const forbiddenPresent=forbidden.filter(k=>env.has(k));
 console.log(JSON.stringify({name,id,moduleHash:Buffer.from(s.module_hash[0]).toString('hex'),controllers:s.settings.controllers.map(p=>p.toText()),environmentCount:env.size,environmentDigest:hash(JSON.stringify([...env].sort())),settings:Object.entries(desired).map(([key,value])=>({key,status:!env.has(key)?'missing':env.get(key)===value?'correct':'different'})),prerequisites,forbiddenPresent}));
 if(!prerequisites||forbiddenPresent.length)failed=true;
}
if(failed)throw Error('Private-name prerequisite failed; no changes made');
console.log('Read-only private-name preflight complete; no changes made');
