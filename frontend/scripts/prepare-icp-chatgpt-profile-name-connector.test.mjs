import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Principal } from '@icp-sdk/core/principal';
import { IbeCiphertext } from '@icp-sdk/vetkeys';
import { prepareOwnProfileFromVerifiedIcp as prepare, DEV_PROFILE_TARGET as dev } from './prepare-icp-chatgpt-profile-name-connector.mjs';

const p = Principal.selfAuthenticating(new Uint8Array(32).fill(27)).toText();
const key=[177,78,48,240,39,234,226,250,163,45,107,185,179,87,249,4,113,97,47,2,140,204,166,139,115,233,231,155,126,96,58,13,177,58,235,166,72,77,108,230,164,14,171,99,8,189,77,249,5,252,123,102,83,62,240,95,130,46,204,29,55,217,215,12,228,80,86,157,252,41,64,98,116,136,172,236,41,43,138,10,130,223,174,28,225,98,96,53,85,12,213,228,186,91,161,192];
const entry = id => ({canister_id:id,declared:true,sources:['ic-architecture']});
const fixture=()=>({
 app:{app_url:dev.app,derivation_origin:dev.origin,canisters:[entry(dev.identity),entry(dev.pii)]},
 identity:{derivation_origin:dev.origin,principal:p,query_only:false},
 authority:{identity_canister:dev.identity,pii_canister:dev.pii,owner_principal:p,verification_key:key},
 name:{value:'Synthetic User',confirmed_by_user:true}
});
test('encrypts synthetic name with official VetKeys and no plaintext output',()=>{
 const result=prepare(fixture());
 assert.equal(result.reference,`pii-display-name:v1:${dev.pii}:${p}`);
 assert.match(result.register_pii_args,/blob "/);
 assert.match(result.set_profile_args,/pii-display-name:v1:/);
 assert.equal(result.register_pii_args.includes('Synthetic User'),false);
 assert.equal(JSON.stringify(result).includes('Synthetic User'),false);
});
test('rejects mismatched caller, origin, target, missing manifest or approval',()=>{
 const mutate=[
 x=>{x.identity.principal='2vxsx-fae';},
 x=>{x.identity.query_only=true;},
 x=>{x.app.derivation_origin='https://igniteclubhq.app';},
 x=>{x.app.canisters[1].declared=false;},
 x=>{x.authority.pii_canister='zt5a6-yiaaa-aaaal-qxp5q-cai';},
 x=>{x.authority.owner_principal='2vxsx-fae';},
 x=>{x.authority.verification_key=[1,2,3];},
 x=>{x.name.confirmed_by_user=false;},
 x=>{x.name.value='bad\\nname';},
 ];
 for(const change of mutate){const x=fixture();change(x);assert.throws(()=>prepare(x));}
});
test('refuses credential/network operations in offline adapter',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const filename of ['prepare-icp-chatgpt-profile-name-connector.mjs','prepare-icp-chatgpt-profile-name-cli.mjs']){
   const source=readFileSync(new URL('./'+filename,import.meta.url),'utf8');
   assert.doesNotMatch(source,/\bfetch\s*\(|\bWebSocket\b|https?\.request\s*\(|\bspawn\s*\(|\bexec\s*\(/);
 }
});
