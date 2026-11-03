import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertEvidenceRequest,evidenceNonce,verifyUpdate} from './prod-protection-evidence.mjs';
const req=createRequire(new URL('../frontend/package.json',import.meta.url));
const sdk={...req('@icp-sdk/core/agent'),...req('@icp-sdk/core/principal'),...req('@icp-sdk/core/candid')};
const {Principal}=sdk;
const expected={canister:Principal.fromUint8Array(Uint8Array.of(1,1)).toText(),governor:Principal.fromUint8Array(Uint8Array.of(2,1)).toText(),method:'read_production_commissioning_evidence',arg:Uint8Array.of(68,73,68,76),nonce:Uint8Array.of(5)};
const content={request_type:'call',canister_id:Principal.fromText(expected.canister),sender:Principal.fromText(expected.governor),method_name:expected.method,arg:expected.arg,nonce:expected.nonce,ingress_expiry:10n};
test('request proof binds exact governor, canister, method, bytes and nonce',()=>{
  assert.equal(assertEvidenceRequest(content,sdk,expected).length,32);
  for(const mutation of [{sender:Principal.anonymous()},{canister_id:Principal.anonymous()},{method_name:'erase'},{arg:Uint8Array.of(0)},{nonce:Uint8Array.of(0)},{request_type:'query'}])
    assert.throws(()=>assertEvidenceRequest({...content,...mutation},sdk,expected));
});
test('post-transform request fields participate in the certified request hash',()=>{
  assert.notDeepEqual(assertEvidenceRequest(content,sdk,expected),assertEvidenceRequest({...content,sender_info:Uint8Array.of(7)},sdk,expected));
});
test('evidence nonce prevents cross-run and cross-purpose reuse',()=>{
  const a={runId:'100',purpose:'inventory',canister:expected.canister,method:expected.method,arg:expected.arg};
  assert.notDeepEqual(evidenceNonce(a),evidenceNonce({...a,runId:'101'}));assert.notDeepEqual(evidenceNonce(a),evidenceNonce({...a,purpose:'protection'}));
});
test('missing or forged certificates cannot be accepted as update evidence',async()=>{
  await assert.rejects(verifyUpdate({version:1,request:'',certificate:''},{sdk,...expected,type:{argTypes:[],retTypes:[]},args:[],runId:'1',purpose:'inventory'}));
});