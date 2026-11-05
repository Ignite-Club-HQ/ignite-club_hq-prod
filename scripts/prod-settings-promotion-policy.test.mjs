import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingProdSettings, applySettingsPlan, settingsTargets } from './prod-settings-promotion-policy.mjs';
import { PROD_CHECK_IDS } from './prod-connection-check-policy.mjs';
import { GROUP_DOMAINS } from './prod-group-readiness.mjs';
import { hashPlan } from './prod-base-group-policy.mjs';
const identity = 'wb3hl-byaaa-aaaai-ayeqa-cai';
const row = (name, value) => ({ name, value });
const base = [row('IGNITE_ACCOUNT_ADMISSION_RELEASE','1'), row('IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL','1'), row('VETKD_KEY_NAME','key_1'), row('IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE','1')];
function inventory() {
  const ids={...PROD_CHECK_IDS};
  const second=Object.fromEntries(GROUP_DOMAINS.map((n,i)=>[n,`g2-${i}`]));
  second.secret_workload_identity=ids.secret_workload_identity;
  const groups=['base','g2'].map(id=>({id,accepting:true,target_alias:'mainnet',domains:[...GROUP_DOMAINS,'secret_workload_identity'].map(domain=>({domain,canister:id==='base'?ids[domain]:second[domain]})),photo_store:[id==='base'?ids.media_blob_store:'g2-photo']}));
  const placements=groups.map(g=>({group_id:g.id,deployment_id:'prod',host:'https://icp-api.io',network_kind:'public_mainnet',primary_subnet:'subnet',approved_subnets:['subnet'],additional_subnets_enabled:false,domains:g.domains.map(d=>({...d,subnet:'subnet'}))}));
  const plan={groupId:'g2',group:{...groups[1],accepting:false},openingAuthorized:false,admissionAuthorized:false};
  return {ids,page:{groups,placements,next_cursor:[],configuration_revision:['7']},receipt:{phase:'registered-closed',pending:null,plan,planHash:hashPlan(plan)}};
}
test('both groups are checked without changing existing open status',()=>{
  const f=inventory(),targets=settingsTargets(f.ids,f.page,f.receipt);
  assert.equal(targets.length,24);
  assert.equal(targets.filter(t=>t.name==='club_domain').length,2);
  assert.equal(f.page.groups[0].accepting,true);
});
test('DEV mapping and foreign placements are refused',()=>{
  const f=inventory();f.ids.club_domain='mzzzv-taaaa-aaaal-qxlrq-cai';
  assert.throws(()=>settingsTargets(f.ids,f.page,f.receipt),/PROD base/);
  const g=inventory();g.page.placements[1].domains[0].canister='foreign';
  assert.throws(()=>settingsTargets(g.ids,g.page,g.receipt),/placement service/);
});
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