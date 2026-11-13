// Offline integration smoke test: real public DEV PII key, synthetic caller, no canister writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Principal} from '@icp-sdk/core/principal';
import {IbeCiphertext} from '@icp-sdk/vetkeys';
import {encryptOwnNameForChatGPT} from '../src/live/chatgptOwnNameCrypto.mjs';
import {DEV_CHATGPT_PRIVATE_NAME as dev} from '../src/live/chatgptOwnNamePolicy.mjs';
const publicKey=Uint8Array.from([177,78,48,240,39,234,226,250,163,45,107,185,179,87,249,4,113,97,47,2,140,204,166,139,115,233,231,155,126,96,58,13,177,58,235,166,72,77,108,230,164,14,171,99,8,189,77,249,5,252,123,102,83,62,240,95,130,46,204,29,55,217,215,12,228,80,86,157,252,41,64,98,116,136,172,236,41,43,138,10,130,223,174,28,225,98,96,53,85,12,213,228,186,91,161,192]);
const principal=Principal.selfAuthenticating(new Uint8Array(32).fill(27)).toText();
const input=()=>({appUrl:dev.appUrl,derivationOrigin:dev.derivationOrigin,identityAccess:dev.identityAccess,piiAuthority:dev.piiAuthority,callerPrincipal:principal,verifiedPrincipal:principal,displayName:'Synthetic Name',verificationKeyBytes:publicKey});
test('actual VetKeys IBE encrypts offline and emits only own-caller write params',()=>{
 const result=encryptOwnNameForChatGPT(input());
 assert.equal(result.pii_id,principal);
 assert.equal(result.field_id,'display_name');
 assert.equal(result.domain_owner,principal);
 assert.equal(result.pii_canister,dev.piiAuthority);
 assert.equal(result.profile_reference,'pii-display-name:v1:'+dev.piiAuthority+':'+principal);
 assert.ok(result.encrypted_bytes.length>50&&result.encrypted_bytes.length<4096);
 assert.doesNotThrow(()=>IbeCiphertext.deserialize(Uint8Array.from(result.encrypted_bytes)));
 assert.equal('name' in result,false);
 assert.equal('displayName' in result,false);
 assert.equal('principalSecret' in result,false);
});
test('same authenticated principal and DEV authority are mandatory',()=>{
 assert.throws(()=>encryptOwnNameForChatGPT({...input(),verifiedPrincipal:'2vxsx-fae'}));
 assert.throws(()=>encryptOwnNameForChatGPT({...input(),appUrl:'https://igniteclubhq.app'}));
 assert.throws(()=>encryptOwnNameForChatGPT({...input(),piiAuthority:'wrong'}));
 assert.throws(()=>encryptOwnNameForChatGPT({...input(),verificationKeyBytes:[1,2,3]}));
});
