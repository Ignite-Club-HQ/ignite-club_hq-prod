import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planOwnNameReuse as plan } from './plan-icp-chatgpt-existing-profile-name.mjs';
import { DEV_PROFILE_TARGET as t } from './prepare-icp-chatgpt-profile-name-connector.mjs';

const caller = 'pfslb-rpozk-543m5-zll3a-a3ay4-rdg3b-elojg-ukmfs-e624l-6rjyp-jae';
const ref = `pii-display-name:v1:${t.pii}:${caller}`;
const record=()=>({pii_id:caller,field_id:'display_name',master_key_id:'vetkey-ibe-v1',ciphertext:Array(256).fill(17)});
const input=()=>({appUrl:t.app,derivationOrigin:t.origin,callerPrincipal:caller,piiCanister:t.pii,
  savedProfileName:ref,encryptedRecordRead:{status:'found',record:record()}});
test('existing encrypted Ignite name is reused with ZERO encryption, write or key-derivation requirements',()=>{
 const result=plan(input());
 assert.deepEqual(result,{status:'REUSE_ENCRYPTED',reference:ref,registerPiiRequired:false,
  profileWriteRequired:false,decryptionVerificationRequired:false});
 assert.equal(JSON.stringify(result).includes('ciphertext'),false);
});
test('partially completed signup with ciphertext but no profile ref resumes, never re-encrypts',()=>{
 const x=input(); x.savedProfileName=null;
 assert.deepEqual(plan(x),{status:'RESUME_REFERENCE',reference:ref,registerPiiRequired:false,
  profileWriteRequired:true,decryptionVerificationRequired:true});
});
test('truly missing profile and ciphertext requires exactly the original VetKeys write path',()=>{
 const x=input(); x.savedProfileName=null; x.encryptedRecordRead={status:'absent'};
 assert.deepEqual(plan(x),{status:'ENCRYPT_NEW',reference:ref,registerPiiRequired:true,
  profileWriteRequired:true,decryptionVerificationRequired:true});
});
test('unknown read, foreign authority, legacy plaintext and missing saved ciphertext fail closed',()=>{
 const changes=[
 x=>{x.appUrl='https://igniteclubhq.app';},
 x=>{x.derivationOrigin='https://igniteclubhq.app';},
 x=>{x.piiCanister='zt5a6-yiaaa-aaaal-qxp5q-cai';},
 x=>{x.callerPrincipal='2vxsx-fae';},
 x=>{x.savedProfileName='Synthetic User';},
 x=>{x.savedProfileName='pii-display-name:v1:zt5a6-yiaaa-aaaal-qxp5q-cai:'+caller;},
 x=>{x.encryptedRecordRead={status:'denied'};},
 x=>{x.encryptedRecordRead={status:'error'};},
 x=>{x.encryptedRecordRead={status:'absent'};},
 x=>{x.encryptedRecordRead.record.pii_id='2vxsx-fae';},
 x=>{x.encryptedRecordRead.record.master_key_id='plaintext';},
 x=>{x.encryptedRecordRead.record.ciphertext=[];},
 ];
 for(const change of changes){const x=input();change(x);assert.throws(()=>plan(x));}
});
test('legacy gateway can only reuse original authority and expected derived origin',()=>{
 const x=input();x.appUrl=t.legacyApp;
 assert.equal(plan(x).status,'REUSE_ENCRYPTED');
 x.derivationOrigin='https://igniteclubhq.app';
 assert.throws(()=>plan(x));
});
