import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PAIR, RELEASE_CONFIRMATION, validateRequest, validatePair, validateRegistration,
  requireWiring, validateJournal, executeTwoCanisterUpgrade
} from './g2-event-notification-upgrade-policy.mjs';
import { digest } from './subscription-upgrade-policy.mjs';
const SHA='f'.repeat(40), OLDQ='a'.repeat(64), OLDC='b'.repeat(64), NEWQ='c'.repeat(64), NEWC='d'.repeat(64);
const SUBNET='e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe';
const Q=PAIR[0].canisterId,C=PAIR[1].canisterId,E='ymvtj-3qaaa-aaaal-qxpza-cai';
const p=x=>({toText:()=>x});
const provision=()=>({
  groupId:'g2',deploymentId:'mainnet',subnetId:SUBNET,
  canisters:{notification_queue:Q,club_domain:C,events_domain:E},
  observedSubnets:{notification_queue:SUBNET,club_domain:SUBNET},
  dedicatedBlobStore:{canisterId:'ycx6b-aaaaa-aaaal-qxpya-cai'}
});
const targets=()=>PAIR.map((x,i)=>({...x,subnetId:SUBNET,newHash:i?NEWC:NEWQ}));
const binding=()=>({
  release:SHA,governor:'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae',
  registryRevision:'11',configurationHash:'1'.repeat(64),
  targets:targets(),provision:provision(),oldHashes:{notification_queue:OLDQ,club_domain:OLDC}
});
const journal=()=>{
  const b=binding();
  return {
    binding:b,routerRevision:'11',configurationHash:'1'.repeat(64),complete:false,
    steps:b.targets.map((x,i)=>({...x,oldHash:i?OLDC:OLDQ,
      settingsHash:'7'.repeat(64),wiringHash:'8'.repeat(64),phase:'ready'}))
  };
};
const live=()=>new Map([[Q,OLDQ],[C,OLDC]]);
function fake(j,opts={}){
  const hashes=live(),events=[],failAt=opts.failAt;
  const io={
    gate:async()=>{events.push('gate');if(opts.gateFail)throw Error('router changed')},
    observe:async step=>({
      moduleHash:hashes.get(step.canisterId),settingsHash:'7'.repeat(64),
      wiringHash:'8'.repeat(64),stableBytes:'12345',cycles:'2000000000000',
      ...(step.name==='club_domain'?{clubs:2n}:{})
    }),
    persist:async()=>{events.push('persist:'+j.steps.map(x=>x.phase).join(','));},
    install:async step=>{
      events.push('install:'+step.name);
      if(failAt===step.name)throw Error('unknown install outcome');
      hashes.set(step.canisterId,step.newHash);
    }
  };
  return {io,hashes,events};
}
test('only a manual exact owner confirmation, exact release and two old hashes allow upgrade',()=>{
  assert.doesNotThrow(()=>validateRequest({action:'check'}));
  assert.throws(()=>validateRequest({action:'check',confirmation:RELEASE_CONFIRMATION}));
  assert.throws(()=>validateRequest({action:'check',expectedQueueHash:OLDQ}));
  const good={action:'upgrade',confirmation:RELEASE_CONFIRMATION,release:SHA,actualCommit:SHA,
    expectedQueueHash:OLDQ,expectedClubHash:OLDC};
  assert.doesNotThrow(()=>validateRequest(good));
  for(const broken of [
    {...good,action:'reload'},{...good,confirmation:'UPGRADE GROUP 2'},
    {...good,release:'e'.repeat(40)},{...good,expectedQueueHash:''},
    {...good,expectedClubHash:'not-a-hash'},{...good,actualCommit:''}
  ])assert.throws(()=>validateRequest(broken));
});
test('allowlist accepts exactly G2 queue first, club second and pinned subnet',()=>{
  assert.doesNotThrow(()=>validatePair(targets(),provision()));
  assert.throws(()=>validatePair(targets().reverse(),provision()));
  assert.throws(()=>validatePair([targets()[0]],provision()));
  assert.throws(()=>validatePair([...targets(),{name:'timer_jobs'}],provision()));
  assert.throws(()=>validatePair(targets().map((t,i)=>i?{...t,canisterId:E}:t),provision()));
  assert.throws(()=>validatePair(targets(),{...provision(),groupId:'g1'}));
  assert.throws(()=>validatePair(targets(),{...provision(),subnetId:'other'}));
  assert.throws(()=>validatePair(targets().map((t,i)=>i?{...t,subnetId:'other'}:t),provision()));
});
test('require exact registered mainnet G2 mapping and correct event/queue wiring',()=>{
  const g={
    id:'g2',target_alias:'mainnet',photo_store:[p(provision().dedicatedBlobStore.canisterId)],
    domains:targets().map(t=>({domain:t.name,canister:p(t.canisterId)}))
  };
  const pl={
    group_id:'g2',deployment_id:'mainnet',host:'https://icp-api.io',
    network_kind:'public_mainnet',primary_subnet:p(SUBNET),
    domains:targets().map(t=>({domain:t.name,canister:p(t.canisterId),subnet:p(t.subnetId)}))
  };
  assert.doesNotThrow(()=>validateRegistration(targets(),[g],[pl],provision()));
  assert.throws(()=>validateRegistration(targets(),[g],[{...pl,host:'https://evil.invalid'}],provision()));
  assert.throws(()=>validateRegistration(targets(),[{...g,domains:[]}],[pl],provision()));
  assert.throws(()=>validateRegistration(targets(),[g],[{...pl,primary_subnet:p('wrong')}],provision()));
  assert.equal(typeof requireWiring('notification_queue',[['club_domain',C],['messaging_domain','some']],provision()),'string');
  assert.equal(typeof requireWiring('club_domain',[['club_domain',C],['notification_queue',Q],['events_domain',E]],provision()),'string');
  assert.throws(()=>requireWiring('notification_queue',[['club_domain','attacker']],provision()));
  assert.throws(()=>requireWiring('club_domain',[['club_domain',C],['notification_queue',Q]],provision()));
  assert.throws(()=>requireWiring('club_domain',[['club_domain',C],['club_domain',C],['notification_queue',Q],['events_domain',E]],provision()));
});
test('journal must be bound to two immutable services, original hash, settings and phase',()=>{
  const j=journal();assert.doesNotThrow(()=>validateJournal(j,j.binding));
  assert.throws(()=>validateJournal({...j,steps:j.steps.slice(0,1)},j.binding));
  assert.throws(()=>validateJournal({...j,steps:j.steps.map((s,i)=>i?{...s,oldHash:NEWC}:s)},j.binding));
  assert.throws(()=>validateJournal({...j,steps:j.steps.map((s,i)=>i?{...s,phase:'installed'}:s)},j.binding));
  assert.throws(()=>validateJournal({...j,binding:{...j.binding,release:'z'.repeat(40)}},j.binding));
  assert.throws(()=>validateJournal({...j,complete:true},j.binding));
  assert.throws(()=>validateJournal({...j,routerRevision:'12'},j.binding));
  assert.throws(()=>validateJournal({...j,configurationHash:'2'.repeat(64)},j.binding));
});
test('the only install order is queue then club, with durable pending intent readback',async()=>{
  const j=journal(),f=fake(j);
  await executeTwoCanisterUpgrade(j,f.io);
  assert.deepEqual(f.events.filter(x=>x.startsWith('install:')),['install:notification_queue','install:club_domain']);
  for(const name of ['notification_queue','club_domain']){
    const index=f.events.indexOf('install:'+name);
    assert.ok(index>0&&f.events[index-1].startsWith('persist:')&&f.events[index-1].includes('pending'));
  }
  assert.equal(j.complete,true);
  assert.ok(j.steps.every(x=>x.phase==='complete'));
  const prior=f.events.length;
  await executeTwoCanisterUpgrade(j,f.io);
  assert.equal(f.events.slice(prior).filter(x=>x.startsWith('install:')).length,0,'completed release never installs again');
});
test('unknown installation outcome retains pending and cannot automatically replay',async()=>{
  const j=journal(),f=fake(j,{failAt:'notification_queue'});
  await assert.rejects(()=>executeTwoCanisterUpgrade(j,f.io),/unknown install outcome/);
  assert.equal(j.steps[0].phase,'pending');
  await assert.rejects(()=>executeTwoCanisterUpgrade(j,f.io),/Unknown upgrade outcome/);
  assert.equal(f.events.filter(x=>x.startsWith('install:')).length,1);
});
test('a routing change fails BEFORE any install',async()=>{
  const j=journal(),f=fake(j,{gateFail:true});
  await assert.rejects(()=>executeTwoCanisterUpgrade(j,f.io),/router changed/);
  assert.equal(f.events.filter(x=>x.startsWith('install:')).length,0);
});
test('workflow cannot deploy on PR or push, install nonpair services, or bypass main/approval',()=>{
  const w=readFileSync(new URL('../.github/workflows/g2-event-notification-pair-upgrade.yml',import.meta.url),'utf8');
  const runner=readFileSync(new URL('../frontend/scripts/upgrade-g2-event-notification.ts',import.meta.url),'utf8');
  assert.match(w,/workflow_dispatch:/);
  assert.match(w,/pull_request:/);
  assert.doesNotMatch(w,/\n  push:/);
  assert.match(w,/if: github\.event_name == 'workflow_dispatch'/);
  assert.match(w,/environment: group-2-admin-controls/);
  assert.match(w,/group: ignite-mainnet-governor-deployment/);
  assert.match(w,/cancel-in-progress: false/);
  assert.match(w,/icp build notification_queue club_domain/);
  assert.doesNotMatch(w,/icp build .*events_domain|icp deploy|icp cycles mint/);
  assert.match(runner,/refs\/heads\/main/);
  assert.match(runner,/validateGroup2Inventory\(provision,shared,'g2'\)/);
  assert.match(runner,/executeTwoCanisterUpgrade/);
  assert.match(runner,/persistGroup2Journal/);
  assert.match(runner,/upgradeArgs\(t,t\.file,GROUP2_GOVERNOR\)/);
  assert.doesNotMatch(runner,/\.fan_out\(|\.enqueue\(|update_settings\(|set_notification_queue_canister\(/);
  assert.match(w,/if: always\(\)/);
  assert.match(w,/rm -f "\$RUNNER_TEMP\/g2-notification.pem"/);
});

test('governor restore supports escaped PEM and stops with nonsecret diagnostic before any build',()=>{
  const w=readFileSync(new URL('../.github/workflows/g2-event-notification-pair-upgrade.yml',import.meta.url),'utf8');
  const restore=w.slice(w.indexOf('- name: Restore only the existing signed Group 2 governor'),w.indexOf('- name: Build ONLY the two bounded service recipes'));
  assert.match(restore,/secrets\.DEPLOYER_PEM/);
  assert.match(restore,/DEPLOYER_PEM could not be normalized/);
  assert.match(restore,/ICP CLI rejected the key format/);
  assert.match(restore,/Restored key principal differs from pinned Group 2 governor/);
  assert.match(restore,/vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae/);
  assert.match(restore,/2>&1/,'import errors must not leak key details');
  assert.doesNotMatch(restore,/echo .*GOVERNOR_PRINCIPAL/);
  assert.doesNotMatch(restore,/echo .*DEPLOYER_PEM/);
});
