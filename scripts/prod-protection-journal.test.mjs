import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProtectionJournal, outcome} from './prod-protection-journal.mjs';
function setup(fault) {
  let receipt={phase:'planned',pending:null}, observed=0, writes=0;
  const journal=createProtectionJournal({load:async()=>structuredClone(receipt),
    save:async r=>{writes++;if(fault===writes)throw Error('lost acknowledgement');receipt=structuredClone(r);},
    probe:async()=>observed});
  return {journal, read:()=>receipt, set:v=>{observed=v;}};
}
test('lost completion write recovers phase and exact progress from retained intent',async()=>{
  const s=setup(2);
  await assert.rejects(s.journal.checkpoint({kind:'upgrade:x',before:3,after:4,commit:{phase:'configured',reloaded:['x']}},async()=>s.set(4)));
  assert.equal(s.read().pending.commit.phase,'configured');
  const r=await s.journal.reconcile();assert.equal(r.phase,'configured');assert.deepEqual(r.reloaded,['x']);assert.equal(r.pending,null);
});
test('failed intent acknowledgement cannot invoke external mutation',async()=>{
  const s=setup(1);let calls=0;
  await assert.rejects(s.journal.checkpoint({kind:'settings:x',before:0,after:1,commit:{}},async()=>{calls++;}));assert.equal(calls,0);
});
test('ambiguous operation retains intent and refuses replay',async()=>{
  const s=setup();await assert.rejects(s.journal.checkpoint({kind:'upgrade:x',before:0,after:1,commit:{}},async()=>s.set(9)));
  await assert.rejects(s.journal.reconcile());assert.ok(s.read().pending);
  await assert.rejects(s.journal.checkpoint({kind:'upgrade:x',before:9,after:10,commit:{}},async()=>{}));
});
test('unchanged program hash alone cannot prove same-program reload',()=>{
  assert.equal(outcome({version:2,before:{hash:'a'},after:{hash:'a'},commit:{}},{hash:'a'}),'unknown');
});
test('before state cannot clear an uncertain submitted operation',async()=>{
  const s=setup();await assert.rejects(s.journal.checkpoint({kind:'settings:x',before:0,after:1,retryable:true,commit:{phase:'done'}},async()=>{throw Error('not sent');}));
  await assert.rejects(s.journal.reconcile());assert.ok(s.read().pending);
  s.set(1);const r=await s.journal.reconcile();assert.equal(r.phase,'done');assert.equal(r.pending,null);
});
test('lifecycle count proves reload even when program bytes do not change',()=>{
  const p={version:2,before:{hash:'a',changes:'10'},after:{hash:'a',changes:'11'},commit:{reloaded:['x']}};
  assert.equal(outcome(p,{hash:'a',changes:'11'}),'committed');assert.equal(outcome(p,{hash:'a',changes:'12'}),'unknown');
});
test('readback uses the acknowledged request metadata persisted during submission',async()=>{
  let receipt={phase:'ready',pending:null};
  const journal=createProtectionJournal({load:async()=>receipt,save:async r=>{receipt=structuredClone(r);},probe:async p=>p.metadata.requestId==='abc'?{replied:true}:null});
  await journal.checkpoint({kind:'subject:protection',before:null,after:{replied:true},commit:{phase:'subject-approved'}},async()=>{
    receipt={...receipt,pending:{...receipt.pending,metadata:{requestId:'abc'}}};
  });
  assert.equal(receipt.phase,'subject-approved');assert.equal(receipt.pending,null);
});