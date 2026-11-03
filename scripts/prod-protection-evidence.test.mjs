import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertEvidenceRequest,evidenceNonce,verifyUpdate,captureUpdate} from './prod-protection-evidence.mjs';
const req=createRequire(new URL('../frontend/package.json',import.meta.url));
const core=process.env.PROTECTION_TEST_SDK_DIR;
const sdk={...req(core?`${core}/lib/cjs/agent`:'@icp-sdk/core/agent'),...req(core?`${core}/lib/cjs/principal`:'@icp-sdk/core/principal'),...req(core?`${core}/lib/cjs/candid`:'@icp-sdk/core/candid')};
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
test('offline verifier accepts a real test-signed certified reply and refuses tampering',async()=>{
  const {bls12_381:bls}=req('@noble/curves/bls12-381');
  const {Cbor,reconstruct,domain_sep,IDL,lebEncode}=sdk;
  const key=new Uint8Array(32);key[31]=9;
  const root=Buffer.concat([Buffer.from('308182301d060d2b0601040182dc7c0503010201060c2b0601040182dc7c05030201036100','hex'),Buffer.from(bls.getPublicKeyForShortSignatures(key))]);
  const type=IDL.Func([],[IDL.Variant({Ok:IDL.Nat64,Err:IDL.Text})],[]);
  const arg=IDL.encode([],[]),runId='100',purpose='inventory';
  const nonce=evidenceNonce({runId,purpose,canister:expected.canister,method:expected.method,arg});
  const call={...content,arg,nonce};const requestId=sdk.requestIdOf(call);
  const leaf=b=>[3,b],label=(s,t)=>[2,typeof s==='string'?Buffer.from(s):s,t];
  const reply=IDL.encode(type.retTypes,[{Ok:8n}]);
  const tree=[1,label('time',leaf(lebEncode(BigInt(Date.now())*1_000_000n))),label('request_status',label(requestId,
    [1,label('status',leaf(Buffer.from('replied'))),label('reply',leaf(reply))]))];
  const hash=await reconstruct(tree),msg=Buffer.concat([domain_sep('ic-state-root'),hash]);
  const certificate=Cbor.encode({tree,signature:bls.signShortSignature(msg,key)});
  const proof={version:1,request:Buffer.from(Cbor.encode(call)).toString('base64'),requestId:Buffer.from(requestId).toString('hex'),certificate:Buffer.from(certificate).toString('base64')};
  // Test-only root injection via SDK wrapper; production always uses the SDK's
  // built-in IC root and provides no root-key option or environment override.
  const testSdk={...sdk,HttpAgent:{createSync:()=>({rootKey:root})}};
  const options={sdk:testSdk,...expected,type,args:[],runId,purpose};
  assert.equal(await verifyUpdate(proof,options),8n);
  const datedProof=async(ageMinutes)=>{
    const dated=[...tree];dated[1]=label('time',leaf(lebEncode(BigInt(Date.now()-ageMinutes*60_000)*1_000_000n)));
    const signed=bls.signShortSignature(Buffer.concat([domain_sep('ic-state-root'),await reconstruct(dated)]),key);
    return {...proof,certificate:Buffer.from(Cbor.encode({tree:dated,signature:signed})).toString('base64')};
  };
  assert.equal(await verifyUpdate(await datedProof(60),options),8n);
  await assert.rejects(verifyUpdate(await datedProof(25*60),options));
  await assert.rejects(verifyUpdate({...proof,certificate:Buffer.from(Cbor.encode({tree,signature:new Uint8Array(48)})).toString('base64')},options));
  await assert.rejects(verifyUpdate(proof,{...options,runId:'101'}));
});
test('capture persists the transformed request before submission and retains certified reply',async()=>{
  const {IDL}=sdk;const type=IDL.Func([],[IDL.Variant({Ok:IDL.Nat64,Err:IDL.Text})],[]);let recorded=false,submitted=false;
  const identity={getPrincipal:()=>Principal.fromText(expected.governor),transformRequest:async r=>({body:{content:{...r.body,sender_info:Uint8Array.of(7)}}})};
  const testSdk={...sdk,HttpAgent:{create:async({identity:wrapped})=>({update:async(canister,{methodName,arg,nonce})=>{
    const r=await wrapped.transformRequest({body:{request_type:'call',canister_id:canister,sender:identity.getPrincipal(),method_name:methodName,arg,nonce,ingress_expiry:10n}});
    assert.ok(recorded);assert.deepEqual(r.body.content.sender_info,Uint8Array.of(7));submitted=true;
    return {reply:IDL.encode(type.retTypes,[{Ok:3n}]),rawCertificate:Uint8Array.of(1)};
  }})}};
  const result=await captureUpdate({identity,sdk:testSdk,canister:expected.canister,method:expected.method,type,args:[],runId:'1',purpose:'inventory',onRequest:async()=>{recorded=true;}});
  assert.ok(submitted);assert.equal(result.value.Ok,3n);assert.equal(result.proof.certificate,'AQ==');
  recorded=false;submitted=false;
  await assert.rejects(captureUpdate({identity,sdk:testSdk,canister:expected.canister,method:expected.method,type,args:[],runId:'1',purpose:'inventory',onRequest:async()=>{throw Error('receipt write failed');}}));
  assert.equal(submitted,false);
});