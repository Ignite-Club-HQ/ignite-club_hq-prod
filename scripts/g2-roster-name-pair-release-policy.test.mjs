import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PAIR, RELEASE_CONFIRMATION, validateRequest, validatePair, validateRegistration,
  requireWiring, validateJournal, executeTwoCanisterUpgrade,
} from './g2-roster-name-pair-release-policy.mjs';

const SHA='f'.repeat(40), SUBNET='e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe';
const P=PAIR[0].canisterId, C=PAIR[1].canisterId;
const Q='zu4gk-vqaaa-aaaal-qxp5a-cai', E='ymvtj-3qaaa-aaaal-qxpza-cai', K='g2-placeholder-competition';
const OLD_P='a'.repeat(64),OLD_C='b'.repeat(64),NEW_P='c'.repeat(64),NEW_C='d'.repeat(64),KEY='e'.repeat(64),FENCE='1'.repeat(64);
const pr=x=>({toText:()=>x});
const provision=()=>({
  groupId:'g2',deploymentId:'mainnet',subnetId:SUBNET,
  canisters:{pii_access_control:P,club_domain:C,notification_queue:Q,events_domain:E,competition_domain:K},
  observedSubnets:{pii_access_control:SUBNET,club_domain:SUBNET},
  dedicatedBlobStore:{canisterId:'dedicated-photo-store'}
});
const targets=()=>PAIR.map((t,i)=>({...t,subnetId:SUBNET,newHash:i?NEW_C:NEW_P}));
const binding=()=>({
  release:SHA,governor:'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae',
  registryRevision:'11',configurationHash:FENCE,verificationKeyHash:KEY,
  provision:provision(),targets:targets(),
  oldHashes:{pii_access_control:OLD_P,club_domain:OLD_C},
});
const journal=()=>{const b=binding();return {
  binding:b,routerRevision:'11',configurationHash:FENCE,complete:false,
  steps:b.targets.map((t,i)=>({...t,oldHash:i?OLD_C:OLD_P,
    settingsHash:'7'.repeat(64),wiringHash:'8'.repeat(64),
    ...(i?{}:{verificationKeyHash:KEY}),phase:'ready'}))
}};
function fixture(j, opts={}) {
  const hashes=new Map([[P,OLD_P],[C,OLD_C]]), events=[];
  const io={
    gate:async()=>{events.push('gate');if(opts.drift)throw Error('router changed');},
    observe:async step=>({
      moduleHash:hashes.get(step.canisterId),settingsHash:'7'.repeat(64),wiringHash:'8'.repeat(64),
      stableBytes:'12000', ...(step.name==='club_domain'?{clubs:2n}:{verificationKeyHash:
        hashes.get(P)===NEW_P && opts.changeKey ? '0'.repeat(64):KEY})
    }),
    persist:async()=>{events.push('persist:'+j.steps.map(x=>x.phase).join(','));},
    install:async step=>{
      events.push('install:'+step.name);
      if(opts.failAt===step.name)throw Error('unknown install outcome');
      hashes.set(step.canisterId,step.newHash);
    }
  };
  return {io,events,hashes};
}
test('read-only check and two original module hashes require separate exact approval',()=>{
  assert.doesNotThrow(()=>validateRequest({action:'check'}));
  assert.throws(()=>validateRequest({action:'check',release:SHA}));
  assert.throws(()=>validateRequest({action:'check',expectedPiiHash:OLD_P}));
  const approved={action:'upgrade',confirmation:RELEASE_CONFIRMATION,
    release:SHA,actualCommit:SHA,expectedPiiHash:OLD_P,expectedClubHash:OLD_C};
  assert.doesNotThrow(()=>validateRequest(approved));
  for(const change of [{action:'reload'},{confirmation:'UPGRADE GROUP 2'},{release:'0'.repeat(40)},
    {expectedPiiHash:'not-hash'},{expectedClubHash:''},{actualCommit:''}])
    assert.throws(()=>validateRequest({...approved,...change}));
});
test('exact G2 PII first, Club second; no other service or subnet',()=>{
  assert.deepEqual(PAIR.map(x=>x.name),['pii_access_control','club_domain']);
  assert.doesNotThrow(()=>validatePair(targets(),provision()));
  for(const bad of [[...targets()].reverse(),[targets()[0]],targets().concat({name:'notification_queue'})])
    assert.throws(()=>validatePair(bad,provision()));
  assert.throws(()=>validatePair(targets(),{...provision(),groupId:'g1'}));
  assert.throws(()=>validatePair(targets(),{...provision(),subnetId:'changed-subnet'}));
  assert.throws(()=>validatePair(targets().map((x,i)=>i?{...x,canisterId:Q}:x),provision()));
});
test('pinned router registration and PII + Club wiring reject substitution',()=>{
  const group={id:'g2',target_alias:'mainnet',photo_store:[pr('dedicated-photo-store')],
    domains:targets().map(t=>({domain:t.name,canister:pr(t.canisterId)}))};
  const place={group_id:'g2',deployment_id:'mainnet',host:'https://icp-api.io',
    network_kind:'public_mainnet',primary_subnet:pr(SUBNET),
    domains:targets().map(t=>({domain:t.name,canister:pr(t.canisterId),subnet:pr(SUBNET)}))};
  assert.doesNotThrow(()=>validateRegistration(targets(),[group],[place],provision()));
  assert.throws(()=>validateRegistration(targets(),[group],[{...place,host:'https://evil.invalid'}],provision()));
  assert.throws(()=>validateRegistration(targets(),[{...group,domains:[]}],[place],provision()));
  assert.equal(typeof requireWiring('pii_access_control',[['club_domain',C],['competition_domain',K]],provision()),'string');
  assert.equal(typeof requireWiring('club_domain',[['club_domain',C],['notification_queue',Q],['events_domain',E]],provision()),'string');
  assert.throws(()=>requireWiring('pii_access_control',[['club_domain','attacker'],['competition_domain',K]],provision()));
  assert.throws(()=>requireWiring('pii_access_control',[['club_domain',C]],provision()));
  assert.throws(()=>requireWiring('club_domain',[['club_domain',C],['events_domain',E]],provision()));
});
test('journal binds original PII key, module/controller hashes, router and safe phases',()=>{
  const j=journal();assert.doesNotThrow(()=>validateJournal(j,j.binding));
  assert.throws(()=>validateJournal({...j,steps:j.steps.slice(0,1)},j.binding));
  assert.throws(()=>validateJournal({...j,steps:j.steps.map((x,i)=>i?x:{...x,verificationKeyHash:'0'.repeat(64)})},j.binding));
  assert.throws(()=>validateJournal({...j,steps:j.steps.map((x,i)=>i?{...x,verificationKeyHash:KEY}:x)},j.binding));
  assert.throws(()=>validateJournal({...j,steps:j.steps.map((x,i)=>i?x:{...x,phase:'installed'})},j.binding));
  assert.throws(()=>validateJournal({...j,binding:{...j.binding,release:'0'.repeat(40)}},j.binding));
  assert.throws(()=>validateJournal({...j,complete:true},j.binding));
  assert.throws(()=>validateJournal({...j,routerRevision:'12'},j.binding));
});
test('durable intent before exactly PII then Club, no replay after complete',async()=>{
  const j=journal(),f=fixture(j);
  await executeTwoCanisterUpgrade(j,f.io);
  assert.deepEqual(f.events.filter(x=>x.startsWith('install:')),['install:pii_access_control','install:club_domain']);
  for(const name of PAIR.map(t=>t.name)){
    const ix=f.events.indexOf('install:'+name);
    assert.ok(ix>0&&f.events[ix-1].startsWith('persist:')&&f.events[ix-1].includes('pending'));
  }
  assert.equal(j.complete,true);
  const prior=f.events.length;
  await executeTwoCanisterUpgrade(j,f.io);
  assert.equal(f.events.slice(prior).filter(x=>x.startsWith('install:')).length,0);
});
test('unknown PII upgrade result cannot be blindly retried',async()=>{
  const j=journal(),f=fixture(j,{failAt:'pii_access_control'});
  await assert.rejects(()=>executeTwoCanisterUpgrade(j,f.io),/unknown install outcome/);
  assert.equal(j.steps[0].phase,'pending');
  await assert.rejects(()=>executeTwoCanisterUpgrade(j,f.io),/Unknown upgrade outcome/);
  assert.equal(f.events.filter(x=>x.startsWith('install:')).length,1);
});
test('PII verification key change blocks Club upgrade and final success',async()=>{
  const j=journal(),f=fixture(j,{changeKey:true});
  await assert.rejects(()=>executeTwoCanisterUpgrade(j,f.io),/original encrypted-name key verification failed/);
  assert.deepEqual(f.events.filter(x=>x.startsWith('install:')),['install:pii_access_control']);
  assert.equal(j.complete,false);
  assert.equal(j.steps[0].phase,'pending');
});
test('a changed router state aborts without installation',async()=>{
  const j=journal(),f=fixture(j,{drift:true});
  await assert.rejects(()=>executeTwoCanisterUpgrade(j,f.io),/router changed/);
  assert.equal(f.events.filter(x=>x.startsWith('install:')).length,0);
});
test('workflow is PR-tests only and manual owner upgrade; never push or all-services',()=>{
  const w=readFileSync(new URL('../.github/workflows/g2-roster-name-pair-upgrade.yml',import.meta.url),'utf8');
  const run=readFileSync(new URL('../frontend/scripts/upgrade-g2-roster-names.ts',import.meta.url),'utf8');
  assert.match(w,/workflow_dispatch:/);
  assert.match(w,/pull_request:/);
  assert.doesNotMatch(w,/\n  push:/);
  assert.match(w,/if: github\.event_name == 'workflow_dispatch'/);
  assert.match(w,/environment: group-2-admin-controls/);
  assert.match(w,/group: ignite-mainnet-governor-deployment/);
  assert.match(w,/cancel-in-progress: false/);
  assert.match(w,/icp build pii_access_control club_domain/);
  assert.doesNotMatch(w,/icp build .*notification_queue|icp deploy|icp cycles mint/);
  assert.match(run,/refs\/heads\/main/);
  assert.match(run,/validateGroup2Inventory\(provision,shared,'g2'\)/);
  assert.match(run,/executeTwoCanisterUpgrade/);
  assert.match(run,/persistGroup2Journal/);
  assert.match(run,/verificationKeyHash/);
  assert.match(run,/VETKD_KEY_NAME/);
  assert.match(run,/upgradeArgs\(t,t\.file,GROUP2_GOVERNOR\)/);
  assert.doesNotMatch(run,/\.fan_out\(|\.enqueue\(|update_settings\(|set_notification_queue_canister\(/);
  assert.match(w,/if: always\(\)/);
  assert.match(w,/rm -f "\$RUNNER_TEMP\/g2-roster-name.pem"/);
});
