import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRouting,matchesRouting,PROPOSED_ROUTING,ROUTING_KEY,ROUTING_CANISTER} from './prod-sign-in-routing-policy.mjs';
test('only PROD shared authority and exact retained clubs are proposed',()=>{
  assert.equal(ROUTING_CANISTER,'tbeh7-5qaaa-aaaai-ayenq-cai');
  assert.deepEqual(PROPOSED_ROUTING.emailAuthClubs.map(c=>c.id),['966bdaec-ebf1-46da-b2b3-cc53bf05c422','493ee2e3-c834-487d-93be-d1c8a0dbc4a8']);
  assert.equal(PROPOSED_ROUTING.defaultBackend,'supabase'); assert.deepEqual(PROPOSED_ROUTING.targets,[]);
});
test('writes one routing key and verifies readback',async()=>{
 let value=null,calls=[];
 const r=await applyRouting({confirmation:'APPLY PROD SIGN IN ROUTING',read:async()=>value,write:async(k,v)=>{calls.push(k);value=v;return {Ok:null};}});
 assert.deepEqual(calls,[ROUTING_KEY]); assert.equal(r.changed,true); assert.ok(matchesRouting(JSON.parse(value)));
});
test('does not overwrite differing live routing',async()=>{
 let writes=0; await assert.rejects(applyRouting({confirmation:'APPLY PROD SIGN IN ROUTING',read:async()=>JSON.stringify({...PROPOSED_ROUTING,targets:[{id:'live'}]}),write:async()=>{writes++;}})); assert.equal(writes,0);
});
test('matching live routing needs no write',async()=>{
 let writes=0; const r=await applyRouting({confirmation:'APPLY PROD SIGN IN ROUTING',read:async()=>JSON.stringify(PROPOSED_ROUTING),write:async()=>{writes++;}}); assert.equal(writes,0); assert.equal(r.changed,false);
});
test('uncertain write is never replayed',async()=>{
 let writes=0; await assert.rejects(applyRouting({confirmation:'APPLY PROD SIGN IN ROUTING',read:async()=>null,write:async()=>{writes++;throw Error('unknown');}})); assert.equal(writes,1);
});