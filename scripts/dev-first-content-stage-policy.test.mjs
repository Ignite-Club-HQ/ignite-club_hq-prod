import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from './all-group-upgrade-policy.mjs';
import { FIRST_CONTENT_DEV as pins, STAGE_CONFIRMATIONS, verifyFirstContentStage } from './dev-first-content-stage-policy.mjs';
const revision='a'.repeat(40);
const hashes={identity_access:pins.identity.next,club_domain:pins.club.next};
const sourceTargets=[pins.identity,pins.club];
const fresh=(stage='identity')=>{
  const binding={
    repo:'Ignite-Club-HQ/ignite-club_hq-prod',
    release:revision,scope:'dev_first_content_admission_preflight',
    governor:pins.governor,host:'https://icp-api.io',
    router:'jcdfe-vqaaa-aaaal-qxloq-cai',configurationRevision:'0',
    targets:sourceTargets.map(s=>({groupId:s.groupId,name:s.name,canisterId:s.id,subnetId:pins.subnet,newHash:s.next})),
    pii:{g1:'iui5p-aaaaa-aaaal-qxllq-cai',g2:'zt5a6-yiaaa-aaaal-qxp5q-cai'},
    wiring:{[pins.club.id]:'49d56de478b4e4488b1753bbb552877997aff303aa3fc022ad7ea9e2dc0650cd'}
  };
  const targets=sourceTargets.map(s=>({...binding.targets.find(t=>t.canisterId===s.id),
    moduleHash:stage==='g2_club'&&s.name==='identity_access'?s.next:s.old,
    settingsHash:s.settings,rawSettingsHash:s.settings,cycles:'2500000000000'}));
  return {binding,planHash:digest(binding),targets,liveAcceptance:false};
};
const args=(stage='identity')=>({action:'check',stage,confirmation:'',checkedPlan:'',sourceRevision:revision,
  candidateHashes:hashes,report:fresh(stage)});
test('identity-first and G2-only stages bind two exact immutable live candidates',()=>{
  const a=verifyFirstContentStage(args());
  const b=verifyFirstContentStage(args('g2_club'));
  assert.equal(a.target.id,pins.identity.id);
  assert.equal(b.target.id,pins.club.id);
  assert.notEqual(a.planHash,b.planHash);
  for(const item of [a,b])assert.match(item.planHash,/^[a-f0-9]{64}$/);
});
test('each install requires a fresh stage-specific plan hash and exact separate words',()=>{
  for(const stage of ['identity','g2_club']){
    const check=verifyFirstContentStage(args(stage));
    const params={...args(stage),action:'upgrade',checkedPlan:check.planHash,confirmation:STAGE_CONFIRMATIONS[stage]};
    assert.equal(verifyFirstContentStage(params).planHash,check.planHash);
    for(const tweak of [
      {checkedPlan:'0'.repeat(64)},
      {confirmation:'UPGRADE ALL MAINNET GROUPS'},
      {confirmation:STAGE_CONFIRMATIONS[stage==='identity'?'g2_club':'identity']},
      {sourceRevision:'b'.repeat(40)},
    ])assert.throws(()=>verifyFirstContentStage({...params,...tweak}));
  }
});
test('deny unsupported recovery, stages or check-mode approval fields',()=>{
  assert.throws(()=>verifyFirstContentStage({...args(),action:'recover'}),/Only check or/);
  assert.throws(()=>verifyFirstContentStage({...args(),stage:'all'}),/exact Identity-first/);
  assert.throws(()=>verifyFirstContentStage({...args(),checkedPlan:'1'}),/Leave confirmation/);
});
test('missing two-canister inventory, substituted ID, source, keys, wiring or state denies',()=>{
  for(const edit of [
    r=>r.binding.scope='full_backend',
    r=>r.binding.release='b'.repeat(40),
    r=>r.binding.targets.pop(),
    r=>r.targets.pop(),
    r=>r.targets[0].canisterId='mzzzv-taaaa-aaaal-qxlrq-cai',
    r=>r.targets[0].moduleHash='f'.repeat(64),
    r=>r.targets[1].settingsHash='f'.repeat(64),
    r=>r.targets[1].cycles='900000000000',
    r=>r.binding.wiring[pins.club.id]='0'.repeat(64),
    r=>r.binding.pii.g2='different-pii-cai',
    r=>r.liveAcceptance=true,
  ]){
    const call=args();edit(call.report);
    // Recalculate genuine binding hash for negative data to distinguish schema guards from hash tamper.
    call.report.planHash=digest(call.report.binding);
    assert.throws(()=>verifyFirstContentStage(call));
  }
});
test('identity must already be upgraded before Group 2 can pass',()=>{
  const call=args('g2_club');call.report.targets[0].moduleHash=pins.identity.old;
  assert.throws(()=>verifyFirstContentStage(call),/wrong target/);
});
test('candidate hash drift and report hash tamper deny independently',()=>{
  const a=args();a.candidateHashes={...hashes,identity_access:'f'.repeat(64)};
  assert.throws(()=>verifyFirstContentStage(a),/wrong target/);
  const b=args();b.report.planHash='0'.repeat(64);
  assert.throws(()=>verifyFirstContentStage(b),/binding or plan/);
});
