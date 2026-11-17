import test from 'node:test';
import assert from 'node:assert/strict';
import {triageDevNameBlockers} from './dev-name-cleanup-triage.mjs';

const fixture = () => ({
  g1: [
    {Club:{id:'club-a',deleted:false}},
    {Club:{id:'deleted-club',deleted:true}},
    {Role:{club:['club-a'],subject:'family-without-account'}},
    {Parent:{child:'child-one',subject:'family-without-account'}},
    {Role:{club:['club-a'],subject:'stray-without-account'}},
    {Role:{club:['club-a'],subject:'legacy-valid-user'}},
    {Role:{club:['club-a'],subject:'converted-user'}},
    {Role:{club:['deleted-club'],subject:'historical-role'}},
  ],
  g2: [
    {Club:{id:'club-b',deleted:false}},
    {Role:{club:['club-a'],subject:'wrong-group-role'}},
    {Role:{club:['missing-club'],subject:'unknown-club-role'}},
  ],
  accounts: [
    {account_id:'a1',principals:['legacy-valid-user'],status:{Active:null},
     profile:[{display_name:'Historical DEV user'}]},
    {account_id:'a2',principals:['converted-user'],status:{Active:null},
     profile:[{display_name:'pii-display-name:v1:dummy:converted-user'}]},
  ],
});
const blockers = {missing_account:2,legacy_plaintext:1,ambiguous_membership:3};

test('triage distinguishes apparent orphans from valid family, legacy and stale-group references',()=>{
  const result=triageDevNameBlockers(fixture(),blockers);
  assert.deepEqual(result.missingAccount,{familyLinked:1,noFamilyLinkObserved:1});
  assert.deepEqual(result.legacyName,{activeAccountRequiresOwnerReview:1});
  assert.deepEqual(result.ambiguousMembership,{deletedClub:1,differentGroup:1,unknownClub:1});
  assert.equal(result.automaticDeletionCandidates,0);
  assert.equal(result.authorisedDeletion,false);
  assert.equal(result.requiresSeparateExactRecordReview,true);
  const serialized=JSON.stringify(result);
  for(const identifier of ['family-without-account','stray-without-account','legacy-valid-user','club-a'])
    assert.ok(!serialized.includes(identifier),'no identities/club IDs in artifact');
});

test('source drift or contradictory audit counts refuse to produce cleanup advice',()=>{
  const f=fixture();
  assert.throws(()=>triageDevNameBlockers(f,{...blockers,missing_account:1}),/no longer agrees/);
  f.accounts.push({...f.accounts[0],account_id:'duplicate'});
  assert.throws(()=>triageDevNameBlockers(f,blockers),/Duplicate or empty account alias/);
});

test('global roles and excluded members are never treated as cleanup candidates',()=>{
  const f=fixture();
  f.g1.push({Role:{club:[],subject:'global-role'}},
            {Excluded:{club:'club-a',subject:'excluded'}},
            {Role:{club:['club-a'],subject:'excluded'}});
  const result=triageDevNameBlockers(f,blockers);
  assert.equal(result.observedIssues.missing_account,2);
  assert.equal(result.authorisedDeletion,false);
});
