import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {identityFromPem} from './prod-connection-check.mjs';
import {assertGovernor} from './icp-environments.mjs';
import {applyRouting,ROUTING_CANISTER,ROUTING_KEY} from './prod-sign-in-routing-policy.mjs';
async function main(){
 const env=process.env;
 if(env.GITHUB_REPOSITORY!=='Ignite-Club-HQ/ignite-club_hq-prod'||env.GITHUB_REF!=='refs/heads/main'||env.IGNITE_ICP_ENV!=='prod') throw Error('Explicit manual production operator context required');
 const req=createRequire(path.join(env.CHECK_DEPS_DIR,'package.json'));
 const {Actor,HttpAgent}=req('@icp-sdk/core/agent'); const {IDL}=req('@icp-sdk/core/candid');
 const {Ed25519KeyIdentity}=req('@icp-sdk/core/identity'); const {Secp256k1KeyIdentity}=req('@icp-sdk/core/identity/secp256k1');
 const identity=identityFromPem(readFileSync(env.CHECK_KEY_PEM,'utf8'),{Ed25519KeyIdentity,Secp256k1KeyIdentity});
 assertGovernor('prod',identity.getPrincipal().toText(),env);
 const agent=await HttpAgent.create({host:'https://icp-api.io',identity,retryTimes:0});
 const actor=Actor.createActor(()=>IDL.Service({get_app_config:IDL.Func([IDL.Text],[IDL.Opt(IDL.Text)],['query']),set_app_config:IDL.Func([IDL.Text,IDL.Text],[IDL.Variant({Ok:IDL.Null,Err:IDL.Text})],[])}),{agent,canisterId:ROUTING_CANISTER});
 const result=await applyRouting({confirmation:env.ROUTING_CONFIRMATION,read:async()=>{const v=await actor.get_app_config(ROUTING_KEY);return v[0]??null;},write:(k,v)=>actor.set_app_config(k,v)});
 console.log(JSON.stringify(result));
}
main().catch(()=>{console.error('Production routing stopped; inspect readback before any retry. No other settings or data changed by this action.');process.exitCode=1;});