import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { identityFromPem } from '../prod-connection-check.mjs';
import { MANAGEMENT_PROXY } from './dev-auto.mjs';
import { validate } from './deployment.mjs';
import { ADMISSION_CONFIRMATION } from './prod-commission-policy.mjs';
import { runProdCommission } from './prod-commission-runner.mjs';

const [work, mode] = process.argv.slice(2);
if (!['check','commission'].includes(mode)) throw Error('Explicit check or commission mode required');
if (mode === 'commission' && process.env.CONFIRMATION !== ADMISSION_CONFIRMATION) throw Error(`Exact confirmation required: ${ADMISSION_CONFIRMATION}`);
const config = JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const peer = JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
if (process.env.GITHUB_REF_NAME!=='prod' || config.environment !== 'opencloud-prod' ||
    config.applicationKey!=='ignite_prod_v2' || config.commissioningMode !== 'existing-accounts-admission-only' ||
    config.apiHost !== 'https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net' || config.operatorId !== MANAGEMENT_PROXY) throw Error('Wrong PROD admission target');
const rows = validate({...config,supabase:{...config.supabase,publishableKey:config.supabase.publishableKey||'sb_publishable_OFFLINE_INSTALL_VALIDATION'}},peer);
const manifest = JSON.parse(fs.readFileSync(path.join(work,'manifest.json')));
if (manifest.environment !== config.environment || manifest.applicationKey !== config.applicationKey ||
    manifest.accountProtectionBuild?.mode !== 'existing-accounts-admission-only' || manifest.canisters.length !== 32 ||
    manifest.engine.operatorId !== MANAGEMENT_PROXY) throw Error('Wrong reviewed PROD artifact manifest');
const require = createRequire(path.resolve('frontend/package.json'));
const {HttpAgent,Actor} = require('@icp-sdk/core/agent');
const {IDL:I} = require('@icp-sdk/core/candid');
const {Principal} = require('@icp-sdk/core/principal');
const {Ed25519KeyIdentity} = require('@icp-sdk/core/identity');
const {Secp256k1KeyIdentity} = require('@icp-sdk/core/identity/secp256k1');
const identity = identityFromPem(fs.readFileSync(process.env.GOVERNOR_PEM_FILE,'utf8'),{Ed25519KeyIdentity,Secp256k1KeyIdentity});
if (identity.getPrincipal().toText() !== config.controllers.governor) throw Error('Wrong governor');
const agent = await HttpAgent.create({host:config.apiHost,identity,shouldFetchRootKey:false});
const B=I.Vec(I.Nat8), P=I.Principal, T=I.Text, N=I.Nat64, V=I.Vec, R=I.Record;
const E=V(R({name:T,value:T}));
const proxy=Actor.createActor(()=>I.Service({proxy:I.Func([R({method:T,args:B,canister_id:P,cycles:I.Nat})],
  [I.Variant({Ok:R({result:B}),Err:I.Variant({CallFailed:R({reason:T}),InsufficientCycles:R({available:I.Nat,required:I.Nat}),UnauthorizedUser:I.Null})})],[])}),
  {agent,canisterId:MANAGEMENT_PROXY});
const pid = text => Principal.fromText(text);
const management=async(method,type,arg,returns=[])=>{
  const reply=await proxy.proxy({method,args:new Uint8Array(I.encode([type],[arg])),canister_id:pid('aaaaa-aa'),cycles:0n});
  if(!('Ok' in reply))throw Error('Management relay refused '+method);
  return I.decode(returns,Uint8Array.from(reply.Ok.result));
};
const Target=R({canister_id:P});
const Status=R({module_hash:I.Opt(B),settings:R({controllers:V(P),environment_variables:E,wasm_memory_limit:I.Nat})});
const status=async id=>(await management('canister_status',Target,{canister_id:pid(id)},[Status]))[0];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const expectedControllers=[MANAGEMENT_PROXY,config.controllers.owner,config.controllers.connectedIdentity,config.controllers.governor].sort();
const verifyControllers=s=>{
  if(JSON.stringify(s.settings.controllers.map(p=>p.toText()).sort())!==JSON.stringify(expectedControllers))throw Error('Controller mismatch');
};
const invoke=async(id,method,types,args,ret=I.Null)=>{
  const actor=Actor.createActor(()=>I.Service({[method]:I.Func(types,[I.Variant({Ok:ret,Err:T})],[])}),{agent,canisterId:id});
  const out=await actor[method](...args);
  if(!('Ok' in out))throw Error(id+' '+method+': '+out.Err);
  console.log(method+' OK');return out.Ok;
};
const optional=async(id,method,types,args,ret)=>{
  try{return await invoke(id,method,types,args,ret);}catch(error){
    if(String(error.message).includes('commissioning required'))return null;
    throw error;
  }
};

const query=async(id,method,ret)=>{
  const actor=Actor.createActor(()=>I.Service({[method]:I.Func([],[ret],['query'])}),{agent,canisterId:id});
  return actor[method]();
};
const saveReport=report=>{if(process.env.CHECK_REPORT_DIR){fs.mkdirSync(process.env.CHECK_REPORT_DIR,{recursive:true});
  fs.writeFileSync(path.join(process.env.CHECK_REPORT_DIR,'opencloud-prod-admission-report.json'),JSON.stringify(report,null,2)+'\n');}};
try{
  await runProdCommission({config,rows,manifest,mode,sourceCommit:process.env.GITHUB_SHA,I,pid,status,verifyControllers,invoke,optional,query,management,saveReport});
}catch{
  console.error('OpenCloud commissioning stopped. Review the sanitized failedTarget/failedMethod report; no uncertain call was retried.');
  process.exitCode=1;
}
