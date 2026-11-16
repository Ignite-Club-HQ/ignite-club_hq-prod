import test from 'node:test';
import assert from 'node:assert/strict';
import {PII,planDevClubNameCoverage as plan,summarizeDevClubNameCoverage as summarize} from './dev-club-name-coverage-policy.mjs';

const g1='club-one',g2='club-two',a='person-a',b='person-b',c='person-c';
const club=(id,deleted=false)=>({Club:{id,deleted}});
const member=(club,subject)=>({Role:{club:[club],subject}});
const profile=(principal,sink,account_id)=>({
  account_id,principals:[principal],status:{Active:null},
  profile:[{display_name:`pii-display-name:v1:${sink}:${principal}`}]
});
const fixture=()=>({
  g1:[club(g1),member(g1,a),member(g1,b)],
  g2:[club(g2),member(g2,a),member(g2,c)],
  accounts:[profile(a,PII.g1,'a'),profile(b,PII.g1,'b'),profile(c,PII.g2,'c')]
});
const observe=target=>({...target,state:'copy_verified'});

test('deduplicates two teams under the SAME club/source key and preserves distinct clubs',()=>{
  const f=fixture();f.g1.push(member(g1,a));
  const x=plan(f);
  assert.equal(x.clubCount,2);
  assert.equal(x.targets.length,4);
  assert.deepEqual(x.issues,{
    missing_account:0,missing_profile:0,legacy_plaintext:0,invalid_reference:0,
    inactive_account:0,ambiguous_membership:0,
  });
  const report=summarize(x,x.targets.map(observe),{snapshotStable:true,backendReaderInstalled:true});
  assert.equal(report.copyCounts.copy_verified,4);
  assert.equal(report.status,'metadata-coverage-complete-release-blocked');
  assert.equal(report.readyToReleaseName,false);
  assert.equal(report.nameReadAuthorised,false);
  assert.equal(report.missingOwnerAuthorisedReadAndDenialAcceptance,true);
  assert.ok(!JSON.stringify(report).includes(a));
  assert.ok(!JSON.stringify(report).includes('pii-display-name:'));
});

test('missing owner name, legacy plaintext and unknown account remain unverified, never inferred absent',()=>{
  const f=fixture();
  f.accounts[1].profile=[{display_name:'Test2'}];
  f.accounts[2].profile=[];
  f.g1.push(member(g1,'unknown-principal'));
  const x=plan(f);
  assert.equal(x.targets.length,2);
  assert.equal(x.issues.legacy_plaintext,1);
  assert.equal(x.issues.missing_profile,1);
  assert.equal(x.issues.missing_account,1);
  const report=summarize(x,[observe(x.targets[0])],{snapshotStable:true,backendReaderInstalled:true});
  assert.equal(report.copyCounts.unverified,1);
  assert.equal(report.status,'incomplete-release-blocked');
  assert.equal(report.readyToReleaseName,false);
});

test('original authority must be pinned and subject must be a real linked alias',()=>{
  const f=fixture();
  f.accounts[0].profile=[{display_name:'pii-display-name:v1:foreign-pii:person-a'}];
  f.accounts[1].profile=[{display_name:`pii-display-name:v1:${PII.g1}:unrelated`}];
  const x=plan(f);
  assert.equal(x.issues.invalid_reference,3); // a has two distinct club memberships
  assert.equal(x.targets.length,1);
});

test('excluded members and globally scoped roles do not grant club name visibility',()=>{
  const f=fixture();
  f.g1.push({Excluded:{subject:b,club:g1}},member(null,a));
  const x=plan(f);
  assert.equal(x.targets.length,3);
  assert.ok(!x.targets.some(t=>t.subject===b));
});

test('revoked, suspended and ambiguous identities never count as covered',()=>{
  const f=fixture();
  f.accounts[2].status={Suspended:null};
  const x=plan(f);
  assert.equal(x.issues.inactive_account,1);
  assert.equal(x.targets.length,3);
  f.accounts.push({...f.accounts[0],account_id:'duplicate-account'});
  assert.throws(()=>plan(f),/Ambiguous account alias/);
});

test('unknown copy states, duplicates and foreign observations fail closed',()=>{
  const x=plan(fixture());
  assert.throws(()=>summarize(x,[{...x.targets[0],state:'plaintext'}]),/Unsupported/);
  assert.throws(()=>summarize(x,[observe(x.targets[0]),observe(x.targets[0])]),/duplicate/);
  assert.throws(()=>summarize(x,[{source:PII.g1,subject:'foreign',club:'foreign',state:'copy_verified'}]),/Foreign/);
  assert.equal(summarize(x,[],{snapshotStable:false,backendReaderInstalled:true}).readyToReleaseName,false);
  assert.equal(summarize(x,[],{snapshotStable:true,backendReaderInstalled:false}).copyCounts.unverified,4);
});

test('incomplete source inventory, duplicate club owners and cross-group roles are blocked',()=>{
  const f=fixture();
  assert.throws(()=>plan({...f,g1:[] ,g2:[]}),/No verified DEV club inventory/);
  assert.throws(()=>plan({...f,g2:[club(g1)]}),/Ambiguous DEV club ownership/);
  f.g2.push(member(g1,a));
  const x=plan(f);
  assert.equal(x.issues.ambiguous_membership,1);
  assert.equal(summarize(x,x.targets.map(observe),{snapshotStable:true,backendReaderInstalled:true}).status,
    'incomplete-release-blocked');
});
