import test from "node:test";
import assert from "node:assert/strict";
import {createIgniteAccountLinker} from "./account-linker.mjs";
import {DEV_ORIGIN} from "./core.mjs";
const now=1794528000000;
const validProof={signed:"cryptographically-verified-by-trusted-adapter"};
function setup({verify,clock=()=>now}={}){
  const pending=new Map(),registry=new Map();let verifications=0;
  const linker=createIgniteAccountLinker({
    clock,
    pendingStore:{
      async create(k,v){if(pending.has(k))throw Error("Duplicate nonce");pending.set(k,v);},
      async consume(k){const r=pending.get(k);pending.delete(k);return r??null;},
    },
    verifyInternetIdentityProof:async(input)=>{
      verifications++;
      if(verify)return verify(input);
      assert.equal(input.origin,DEV_ORIGIN);
      assert.equal(input.proof,validProof);
      return {principal:"user-principal",derivationOrigin:DEV_ORIGIN,
        delegationVerified:true,actorFactory:()=>({}),expiresAtMs:now+3600000};
    },
    delegatedRegistry:{async link(s,r){registry.set(s,r);}},
  });
  return {linker,pending,registry,verifyCount:()=>verifications};
}
const request={oauthSubject:"oauth-subject-1",
  oauthScopes:["ignite:read","ignite:chat:send"],
  requestedScopes:["ignite:read","ignite:chat:send"]};
test("one-time linking verifies II delegation and stores caller-bound permissions",async()=>{
 const {linker,registry}=setup();
 const start=await linker.begin(request);
 assert.equal(start.derivation_origin,DEV_ORIGIN);
 assert.equal(start.state.length,43);
 assert.equal(start.challenge.length,43);
 assert.equal(start.link_id.length,43);
 const result=await linker.complete({
   oauthSubject:request.oauthSubject,linkId:start.link_id,
   state:start.state,proof:validProof,
 });
 assert.equal(result.linked,true);
 assert.equal(result.principal,"user-principal");
 assert.equal(registry.get("oauth-subject-1").principal,"user-principal");
 assert.deepEqual(registry.get("oauth-subject-1").approvedScopes,["ignite:read","ignite:chat:send"]);
});
test("replay, mismatched OAuth subjects and state fail closed",async()=>{
 const {linker,registry}=setup();
 const first=await linker.begin(request);
 await assert.rejects(linker.complete({oauthSubject:"another-user",
   linkId:first.link_id,state:first.state,proof:validProof}),/mismatched/);
 await assert.rejects(linker.complete({oauthSubject:request.oauthSubject,
   linkId:first.link_id,state:first.state,proof:validProof}),/replayed/);
 const second=await linker.begin(request);
 await assert.rejects(linker.complete({oauthSubject:request.oauthSubject,
   linkId:second.link_id,state:"invalid".repeat(7).slice(0,43),proof:validProof}),/mismatched/);
 assert.equal(registry.size,0);
});
test("never elevate scopes beyond originally authenticated OAuth consent",async()=>{
 const {linker}=setup();
 await assert.rejects(linker.begin({...request,oauthScopes:["ignite:read"]}),/consent scope invalid/);
 await assert.rejects(linker.begin({...request,requestedScopes:["ignite:admin"]}),/consent scope invalid/);
 const result=await linker.begin({...request,oauthScopes:["ignite:read"],requestedScopes:["ignite:read"]});
 assert.equal(result.derivation_origin,DEV_ORIGIN);
});
test("wrong derivation origin or missing signed actor blocks linking",async()=>{
 const {linker,registry}=setup({verify:async()=>({
   principal:"user-principal",derivationOrigin:"https://igniteclubhq.app",
   delegationVerified:true,actorFactory:()=>({}),expiresAtMs:now+3600000,
 })});
 const a=await linker.begin(request);
 await assert.rejects(linker.complete({oauthSubject:request.oauthSubject,
   linkId:a.link_id,state:a.state,proof:validProof}),/validation failed/);
 assert.equal(registry.size,0);
});
test("expired challenges and delegation proof are rejected",async()=>{
 let clock=now;const {linker}=setup({clock:()=>clock});
 const a=await linker.begin(request);clock+=310000;
 await assert.rejects(linker.complete({oauthSubject:request.oauthSubject,
   linkId:a.link_id,state:a.state,proof:validProof}),/expired/);
 const b=setup({verify:async()=>({
   principal:"user-principal",derivationOrigin:DEV_ORIGIN,
   delegationVerified:true,actorFactory:()=>({}),expiresAtMs:now+100,
 })});
 const t=await b.linker.begin(request);
 await assert.rejects(b.linker.complete({oauthSubject:request.oauthSubject,
   linkId:t.link_id,state:t.state,proof:validProof}),/validation failed/);
});
test("requires atomic store and cryptographically trusted verifier",()=>{
 assert.throws(()=>createIgniteAccountLinker(),/Atomic linking store/);
});
