// Certified update replies can be verified by separated signing jobs without
// exporting the governor key or delegating its privileged canister access.
import {createHash} from 'node:crypto';
const hex=v=>Buffer.from(v).toString('hex');
const b64=v=>Buffer.from(v).toString('base64');
const bytes=v=>Uint8Array.from(Buffer.from(v,'base64'));
export const evidenceNonce=({runId,purpose,canister,method,arg})=>createHash('sha256')
  .update(`ignite:commissioning-evidence:v1\0${runId}\0${purpose}\0${canister}\0${method}\0`)
  .update(arg).digest();
export function assertEvidenceRequest(content,{Principal,requestIdOf},expected) {
  const p=v=>Principal.from(v).toText();
  if(content.request_type!=='call'||p(content.canister_id)!==expected.canister||p(content.sender)!==expected.governor||
     content.method_name!==expected.method||hex(content.arg)!==hex(expected.arg)||hex(content.nonce)!==hex(expected.nonce))
    throw Error('Certified commissioning request binding mismatch');
  return requestIdOf(content);
}
export async function captureUpdate({identity,sdk,canister,method,type,args,runId,purpose,onRequest}) {
  const {IDL,Cbor,requestIdOf,Principal}=sdk;
  const arg=IDL.encode(type.argTypes,args),nonce=evidenceNonce({runId,purpose,canister,method,arg});
  // Dedicated short-lived capture agent identity; do not mutate a shared identity.
  let content;
  const captureIdentity={getPrincipal:()=>identity.getPrincipal(),transformRequest:async request=>{
    const transformed=await identity.transformRequest(request);
    if(transformed.body?.content?.request_type==='call'&&transformed.body.content.method_name===method)
      {content=transformed.body.content;
        if(onRequest)await onRequest({request:b64(Cbor.encode(content)),requestId:hex(requestIdOf(content)),canister,method});}
    return transformed;
  }};
  const dedicated=await sdk.HttpAgent.create({host:'https://icp-api.io',identity:captureIdentity});
  const result=await dedicated.update(Principal.fromText(canister),{methodName:method,arg,nonce,effectiveCanisterId:Principal.fromText(canister)});
  if(!content||!result.rawCertificate)throw Error('Missing certified commissioning evidence');
  const requestId=assertEvidenceRequest(content,sdk,{canister,method,arg,nonce,governor:identity.getPrincipal().toText()});
  return {value:IDL.decode(type.retTypes,result.reply)[0],proof:{version:1,request:b64(Cbor.encode(content)),requestId:hex(requestId),certificate:b64(result.rawCertificate)}};
}
export async function readUpdateAcknowledgement({agent,sdk,request,type}) {
  if(!request?.requestId||!request.canister)return null;
  const requestId=Uint8Array.from(Buffer.from(request.requestId,'hex'));
  const {Certificate,Principal,lookupResultToBuffer}=sdk;
  const state=await agent.readState(Principal.fromText(request.canister),{paths:[[Buffer.from('request_status'),requestId]]});
  const cert=await Certificate.create({certificate:state.certificate,rootKey:agent.rootKey,principal:{canisterId:Principal.fromText(request.canister)}});
  const status=lookupResultToBuffer(cert.lookup_path(['request_status',requestId,'status']));
  if(!status||Buffer.from(status).toString()!=='replied')return null;
  const reply=lookupResultToBuffer(cert.lookup_path(['request_status',requestId,'reply']));
  if(!reply)return null;
  const value=sdk.IDL.decode(type.retTypes,reply)[0];
  if(value&&'Err'in value)throw Error('Certified mutation was refused');
  return {replied:true,value};
}
export async function verifyUpdate(proof,{sdk,canister,method,type,args,runId,purpose,governor}) {
  if(proof?.version!==1||typeof proof.request!=='string'||typeof proof.certificate!=='string'||
      proof.request.length>8_000_000||proof.certificate.length>8_000_000)throw Error('Bounded certified evidence required');
  const {IDL,Cbor,Certificate,lookupResultToBuffer,Principal,HttpAgent}=sdk;
  const arg=IDL.encode(type.argTypes,args),nonce=evidenceNonce({runId,purpose,canister,method,arg});
  const content=Cbor.decode(bytes(proof.request));
  const requestId=assertEvidenceRequest(content,sdk,{canister,method,arg,nonce,governor});
  if(hex(requestId)!==proof.requestId)throw Error('Commissioning request ID mismatch');
  // Never fetch or accept a root key from the receipt, caller or remote host.
  const rootKey=HttpAgent.createSync({host:'https://icp-api.io'}).rootKey;
  // Retained request-bound certificates share the 24-hour signed-approval
  // window. Signers still re-read live module/controller/subnet fences; delivery
  // repeats that verification and the canisters validate current lifecycle and
  // expiry. No unbounded historical certificate or time-verification bypass.
  const certificate=await Certificate.create({certificate:bytes(proof.certificate),rootKey,principal:{canisterId:Principal.fromText(canister)},maxAgeInMinutes:24*60});
  const path=['request_status',requestId];
  const status=lookupResultToBuffer(certificate.lookup_path([...path,'status']));
  const reply=lookupResultToBuffer(certificate.lookup_path([...path,'reply']));
  if(!status||Buffer.from(status).toString()!=='replied'||!reply)throw Error('Certified successful reply required');
  const result=IDL.decode(type.retTypes,reply)[0];
  if(!result||'Err'in result)throw Error('Commissioning evidence contains a refusal');
  return result.Ok;
}