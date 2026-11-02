import test from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_DOMAINS, validateTwoGroupInventory, validateHumanSeals, assertWorkerCapabilityDenied } from './two-group-removal-evidence.mjs';
test('ungranted notification worker must reject with the exact capability trap',async()=>{
 await assertWorkerCapabilityDenied(async()=>{throw new Error("Canister called ic0.trap: Worker capability required");});
});
test('Candid refusals, success and unrelated failures cannot satisfy worker capability denial',async()=>{
 for(const result of [{Err:'Notification lease owner required'},{Ok:{status:{Delivered:null}}}])
  await assert.rejects(()=>assertWorkerCapabilityDenied(async()=>result),/Missing expected rejection/);
 for(const message of ['Connection closed','Account admission denied','Notification lease owner required'])
  await assert.rejects(()=>assertWorkerCapabilityDenied(async()=>{throw new Error(message);}),/did not match/);
});
const groups = ['base','g2'].map(id => ({id, timer:`${id}/timer`, receivers:HUMAN_DOMAINS.map(domain=>({domain,id:`${id}/${domain}`}))}));
const targets = [...groups.flatMap(g=>[g.timer,...g.receivers.map(s=>s.id)]),'shared','router'];
test('complete installed two-group inventory is exactly 28 unique targets',()=>assert.equal(validateTwoGroupInventory(groups,targets,'shared','router'),28));
test('omitted, duplicated and foreign infrastructure or receiver targets fail closed',()=>{
 for(const ids of [targets.slice(1),[...targets,'foreign'],[...targets.slice(1),targets[1]]])
  assert.throws(()=>validateTwoGroupInventory(groups,ids,'shared','router'));
 const bad=structuredClone(groups);bad[1].receivers[0].id=bad[0].receivers[0].id;
 assert.throws(()=>validateTwoGroupInventory(bad,targets,'shared','router'));
});
const request={account_id:'account',generation:7n,subjects:['primary','alias'],inventory_digest:Array(32).fill(7)};
const seals=groups.flatMap(g=>g.receivers.map(s=>({receiver:s.id,request:structuredClone(request),outstanding:0n})));
test('complete human seals require all 24 receivers and both account aliases',()=>assert.equal(validateHumanSeals(groups,request,seals),true));
test('missing, duplicate, outstanding and stale seals cannot certify complete removal',()=>{
 for(const change of [s=>s.pop(),s=>s[1]=s[0],s=>s[23].outstanding=1n,s=>s[23].request.generation=6n,
  s=>s[23].request.subjects.pop(),s=>s[23].request.inventory_digest[0]=8]){
  const bad=structuredClone(seals);change(bad);assert.throws(()=>validateHumanSeals(groups,request,bad));
 }
});