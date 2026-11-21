import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDevNameCleanupPreflight} from './dev-name-cleanup-exact-preflight.mjs';

const fixture=()=>({
 fingerprint:'a'.repeat(64),
 g1:[
  {Club:{id:'active-g1',deleted:false}},
  {Club:{id:'deleted-g1',deleted:true}},
  {Role:{club:['active-g1'],subject:'missing-user'}},
  {Role:{club:['active-g1'],subject:'family-user'}},
  {Guardian:{child:'child-one',subject:'family-user'}},
  {Role:{club:['active-g1'],subject:'valid-legacy'}},
  {Role:{club:['deleted-g1'],subject:'deleted-role'}},
 ],
 g2:[
  {Club:{id:'active-g2',deleted:false}},
  {Role:{club:['gone-club'],subject:'unknown-role'}},
  {Role:{club:['active-g1'],subject:'wrong-group-role'}},
 ],
 accounts:[
  {account_id:'legacy-account',principals:['valid-legacy'],status:{Active:null},
   profile:[{display_name:'Valid but legacy'}]},
 ],
});
const issues={missing_account:2,legacy_plaintext:1,ambiguous_membership:3};

test('exact preflight keeps six individual review edges but returns no identifying values',()=>{
 const r=buildDevNameCleanupPreflight(fixture(),issues);
 assert.equal(r.reviewItems.length,6);
 assert.deepEqual(r.counts,issues);
 assert.equal(new Set(r.reviewItems.map(x=>x.handle)).size,6);
 assert.equal(r.reviewItems.filter(x=>x.finding==='legacy_name')[0].disposition,
   'PRESERVE_ACCOUNT_REVIEW_NAME');
 assert.ok(r.reviewItems.some(x=>x.dependency==='family_link_present'));
 assert.equal(r.reviewItems.every(x=>x.approvedForDeletion===false),true);
 assert.equal(r.reviewItems.every(x=>x.exactRoleGrantReadbackRequired===true),true);
 assert.equal(r.approvedForDeletion,false);
 assert.match(r.exactPlanHash,/^[a-f0-9]{64}$/);
 const exported=JSON.stringify(r);
 for(const id of ['missing-user','family-user','valid-legacy','deleted-role',
  'unknown-role','wrong-group-role','active-g1','gone-club','Valid but legacy','child-one'])
  assert.ok(!exported.includes(id),'no identities in report: '+id);
});
test('plan remains stable on identical snapshot and invalidates on changed snapshot',()=>{
 const f=fixture(), first=buildDevNameCleanupPreflight(f,issues);
 assert.deepEqual(buildDevNameCleanupPreflight(f,issues),first);
 f.fingerprint='b'.repeat(64);
 const second=buildDevNameCleanupPreflight(f,issues);
 assert.notEqual(second.exactPlanHash,first.exactPlanHash);
});
test('fail closed on incomplete snapshot, mismatched audit and duplicate aliases',()=>{
 const f=fixture();
 assert.throws(()=>buildDevNameCleanupPreflight({...f,fingerprint:''},issues),/fingerprint/);
 assert.throws(()=>buildDevNameCleanupPreflight(f,{...issues,missing_account:1}),/agree|differs/);
 f.accounts.push({...f.accounts[0],account_id:'duplicate'});
 assert.throws(()=>buildDevNameCleanupPreflight(f,issues),/Duplicate/);
});
test('excluded, global and fully encrypted account roles do not become candidates',()=>{
 const f=fixture();
 f.g1.push({Excluded:{club:'active-g1',subject:'excluded'}},
  {Role:{club:['active-g1'],subject:'excluded'}},
  {Role:{club:[],subject:'global-user'}},
  {Role:{club:['active-g1'],subject:'secure-user'}});
 f.accounts.push({account_id:'secure',principals:['secure-user'],
  status:{Active:null},profile:[{display_name:'pii-display-name:v1:sink:secure-user'}]});
 const r=buildDevNameCleanupPreflight(f,issues);
 assert.equal(r.reviewItems.length,6);
});
