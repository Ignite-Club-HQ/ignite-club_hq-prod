import test from 'node:test';
import assert from 'node:assert/strict';
import { assessOriginalG1PiiAuthority as assess } from './dev-g1-private-name-authority-policy.mjs';

const expected={identity:'mq2sj-fiaaa-aaaal-qxlqa-cai',
  originalClub:'mzzzv-taaaa-aaaal-qxlrq-cai',
  originalPii:'iui5p-aaaaa-aaaal-qxllq-cai'};
const hash='f80ed20bc0d8a244f40b31fdbd0024ff469d24254197dce9242dce669fa1f34d';
const pins=()=>({
  expected,governor:'pinned-dev-governor',controllers:['pinned-dev-governor'],
  environment:[
    {name:'VETKD_KEY_NAME',value:'key_1'},
    {name:'IGNITE_PRIVATE_PROFILE_IDENTITY',value:expected.identity},
    {name:'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL',value:'0'},
    {name:'IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE',value:'1'},
    {name:'UNRELATED_SENSITIVE_SETTING',value:'not-for-report-123'},
  ],
  opening:[['club_domain',expected.originalClub],['competition_domain','']],
  publicKeySha256:hash,previousReadSha256:hash
});
test('read-only previous-observation continuity and exact verifier/source settings',()=>{
  const result=assess(pins());
  assert.equal(result.previouslyObservedKeyMatches,true);
  assert.equal(result.identityVerifierPinned,true);
  assert.equal(result.originalGroup1ClubPinned,true);
  assert.equal(result.governorControllerPresent,true);
  assert.equal(result.immutableKeyNamePresent,true);
  assert.equal(result.privateProfileRehearsalDisabled,true);
  assert.equal(result.originalAuthoritySettingsMatch,true);
  assert.equal(result.originalPiiDisplaySwitchEnabled,true);
  assert.equal(result.historicalOriginalKeyContinuityVerified,false);
  assert.equal(result.completeIdentityLegacyPiiAllowlistVerified,false);
  assert.equal(result.exactTeamNameAudienceReleased,false);
  assert.equal(result.readyToReleaseName,false);
  assert.equal(result.nameReadAuthorised,false);
  assert.ok(!JSON.stringify(result).includes('not-for-report-123'),'management environment must never leak');
  assert.ok(!JSON.stringify(result).includes('UNRELATED_SENSITIVE_SETTING'));
});

test('missing or foreign verifier, wrong original club, missing key setting and controller are flagged',()=>{
  for(const [description,mutate,property] of [
    ['foreign verifier',x=>x.environment.find(e=>e.name==='IGNITE_PRIVATE_PROFILE_IDENTITY').value='wrong','identityVerifierPinned'],
    ['missing verifier',x=>x.environment=x.environment.filter(e=>e.name!=='IGNITE_PRIVATE_PROFILE_IDENTITY'),'identityVerifierPinned'],
    ['foreign Club',x=>x.opening[0][1]='other-club','originalGroup1ClubPinned'],
    ['missing key name',x=>x.environment=x.environment.filter(e=>e.name!=='VETKD_KEY_NAME'),'immutableKeyNamePresent'],
    ['non-controller',x=>x.controllers=['foreign'],'governorControllerPresent'],
    ['rehearsal accidentally enabled',x=>x.environment.find(e=>e.name==='IGNITE_PRIVATE_PROFILE_READS_REHEARSAL').value='1','privateProfileRehearsalDisabled'],
  ]){
    const x=pins();mutate(x);
    const got=assess(x);
    assert.equal(got[property],false,description);
    assert.equal(got.originalAuthoritySettingsMatch,false,description);
    assert.equal(got.readyToReleaseName,false);
    assert.equal(got.nameReadAuthorised,false);
  }
});

test('previous-observed digest mismatch never gets misreported as historical continuity',()=>{
  const x=pins();x.publicKeySha256='0'.repeat(64);
  const result=assess(x);
  assert.equal(result.previouslyObservedKeyMatches,false);
  assert.equal(result.historicalOriginalKeyContinuityVerified,false);
  assert.equal(result.readyToReleaseName,false);
});

test('duplicate protected runtime keys and malformed management result fail closed',()=>{
  for(const name of ['IGNITE_PRIVATE_PROFILE_IDENTITY','VETKD_KEY_NAME']){
    const x=pins();x.environment.push({name,value:'attacker-override'});
    assert.throws(()=>assess(x),/Duplicate protected PII setting/);
  }
  for(const bad of [
    {...pins(),publicKeySha256:'invalid'},
    {...pins(),environment:[{name:'VETKD_KEY_NAME',value:1}]},
    {...pins(),opening:null},
    {...pins(),controllers:[null]},
    {...pins(),environment:Array(129).fill({name:'safe',value:'1'})},
  ])assert.throws(()=>assess(bad));
});
