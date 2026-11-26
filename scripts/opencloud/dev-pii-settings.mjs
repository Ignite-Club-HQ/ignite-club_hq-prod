import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { identityFromPem } from '../prod-connection-check.mjs';
import { guard, activation, MANAGEMENT_PROXY } from './dev-auto.mjs';
const mode = process.argv[2];
if (!['check','apply'].includes(mode)) throw Error('Explicit mode required');
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
const expected=[MANAGEMENT_PROXY,config.controllers.owner,config.controllers.connectedIdentity,config.controllers.governor].sort();
const verifyControllers=s=>{if(JSON.stringify(s.settings.controllers.map(p=>p.toText()).sort())!==JSON.stringify(expected))throw Error('Controller mismatch');};

const targets=rows.filter(r=>r.service==='pii_access_control');
const exact=['ekzhk-jaaaa-aaac5-aadya-cai','fjvom-5yaaa-aaac5-aad6q-cai'].sort();
if(JSON.stringify(targets.map(r=>r.id).sort())!==JSON.stringify(exact)||config.shared.identity_access!=='h5lly-yyaaa-aaac5-aadqq-cai')throw Error('Unexpected DEV PII inventory');
const desired={IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE:'1',IGNITE_SECURE_ADULT_NAME_IDENTITY:config.shared.identity_access};
const snapshot=async t=>{const s=await status(t.id);verifyControllers(s);if(!s.module_hash.length)throw Error('Missing installed module');return s;};
const before=await Promise.all(targets.map(snapshot));
for(let i=0;i<targets.length;i++){
 const t=targets[i],s=before[i],vars=new Map(s.settings.environment_variables.map(v=>[v.name,v.value]));
 for(const [k,v] of Object.entries(desired)){console.log(t.name+' '+k+': '+(vars.has(k)?vars.get(k)===v?'correct':'different':'missing'));if(vars.has(k)&&vars.get(k)!==v)throw Error('Unexpected existing setting; stop');}
}
if(mode==='check')process.exit(0);
for(let i=0;i<targets.length;i++){
 const t=targets[i],s=await snapshot(t),vars=new Map(s.settings.environment_variables.map(v=>[v.name,v.value]));
 if(Buffer.from(s.module_hash[0]).toString('hex')!==Buffer.from(before[i].module_hash[0]).toString('hex'))throw Error('Module changed');
 for(const [k,v] of Object.entries(desired)){if(vars.has(k)&&vars.get(k)!==v)throw Error('Conflicting setting');vars.set(k,v);}
 const env=[...vars].map(([name,value])=>({name,value}));
 if(env.length!==s.settings.environment_variables.length)await call('update_settings',I.Record({canister_id:P,settings:I.Record({environment_variables:I.Opt(E)})}),{canister_id:pid(t.id),settings:{environment_variables:[env]}});
 const after=await snapshot(t),actual=new Map(after.settings.environment_variables.map(v=>[v.name,v.value]));
 if(actual.size!==vars.size||env.some(x=>actual.get(x.name)!==x.value)||Buffer.from(after.module_hash[0]).toString('hex')!==Buffer.from(s.module_hash[0]).toString('hex')||after.settings.wasm_memory_limit!==s.settings.wasm_memory_limit)throw Error('Readback mismatch');
 console.log('Verified settings and unchanged module: '+t.name);
}
