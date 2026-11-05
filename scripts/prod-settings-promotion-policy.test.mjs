import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingProdSettings, applySettingsPlan } from './prod-settings-promotion-policy.mjs';
const identity = 'wb3hl-byaaa-aaaai-ayeqa-cai';
const row = (name, value) => ({ name, value });
const base = [row('IGNITE_ACCOUNT_ADMISSION_RELEASE','1'), row('IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL','1'), row('VETKD_KEY_NAME','key_1'), row('IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE','1')];
test('matching PROD identity replaces rehearsal conflict while retaining admission', () => {
  const map = new Map(matchingProdSettings(base,identity).next.map(r=>[r.name,r.value]));
  assert.equal(map.get('IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL'),'0');
  assert.equal(map.get('IGNITE_ACCOUNT_SERVICE_IDENTITY'),identity);
  assert.equal(map.get('IGNITE_ACCOUNT_ADMISSION_RELEASE'),'1');
});
test('keys and separately enabled feature switches survive', () => {
  const map = new Map(matchingProdSettings(base,identity).next.map(r=>[r.name,r.value]));
  assert.equal(map.get('VETKD_KEY_NAME'),'key_1');
  assert.equal(map.get('IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE'),'1');
  assert.equal(map.has('IGNITE_ACCOUNT_REMOVAL_RELEASE'),false);
});
test('dormant production admission and removal are not enabled', () => {
  assert.deepEqual(matchingProdSettings([],identity),{next:[],changed:false});
});
test('DEV authority cannot be promoted', () => {
  assert.throws(()=>matchingProdSettings(base,'mq2sj-fiaaa-aaaal-qxlqa-cai'),/Exact PROD/);
  assert.throws(()=>matchingProdSettings([...base,row('IGNITE_ACCOUNT_SERVICE_IDENTITY','mq2sj-fiaaa-aaaal-qxlqa-cai')],identity),/Foreign/);
});
test('removal without admission is held, never repaired by activation', () => {
  assert.throws(()=>matchingProdSettings([row('IGNITE_ACCOUNT_REMOVAL_RELEASE','1')],identity),/separate review/);
});
test('rehearsal-only protection cannot be disabled implicitly', () => {
  assert.throws(()=>matchingProdSettings([row('IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL','1')],identity),/separate review/);
});
test('second unavailable exact module prevents all settings writes', async () => {
  let writes=0;
  await assert.rejects(applySettingsPlan([{changed:true,id:'one'},{changed:true,id:'two'}],{prepare:async p=>{if(p.id==='two')throw Error('unavailable');},write:async()=>writes++}),/unavailable/);
  assert.equal(writes,0);
});
test('settings drift stops before mutation', async () => {
  let writes=0;
  await assert.rejects(applySettingsPlan([{changed:true,before:[],moduleHash:'abc'}],{prepare:async()=>{},read:async()=>({environment:[row('A','new')],moduleHash:'abc'}),write:async()=>writes++}),/drift/);
  assert.equal(writes,0);
});
test('successful repair reads back settings and the same module before acknowledgment', async () => {
  const p={changed:true,before:base,next:matchingProdSettings(base,identity).next,moduleHash:'same'};
  let env=base; const calls=[];
  await applySettingsPlan([p],{prepare:async()=>calls.push('prepare'),read:async()=>({environment:env,moduleHash:'same'}),intent:async()=>calls.push('intent'),write:async()=>{env=p.next;calls.push('write');},restart:async()=>calls.push('restart'),ack:async()=>calls.push('ack')});
  assert.deepEqual(calls,['prepare','intent','write','restart','ack']);
});