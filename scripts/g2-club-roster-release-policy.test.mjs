import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TARGET, CONFIRMATION, validateRequest, validateTarget, validateRegistration,
  validateJournal, executeUpgrade
} from './g2-club-roster-release-policy.mjs';
import { digest } from './subscription-upgrade-policy.mjs';

const sha='a'.repeat(40), oldHash='b'.repeat(64), newHash='c'.repeat(64);
const subnet='e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe';
const target={...TARGET,subnetId:subnet,newHash};
const provision={groupId:'g2',deploymentId:'mainnet',subnetId:subnet,
  canisters:{club_domain:TARGET.canisterId,notification_queue:'zu4gk-vqaaa-aaaal-qxp5a-cai',events_domain:'other'},
  observedSubnets:{club_domain:subnet},dedicatedBlobStore:{canisterId:'blob'}};
const binding={release:sha,governor:'governor',router:'router',registryRevision:'9',configurationHash:'d'.repeat(64),
  provision,provisionHash:'e'.repeat(64),oldHash,target};
const step=()=>({name:'club_domain',groupId:'g2',canisterId:TARGET.canisterId,subnetId:subnet,
  oldHash,newHash,settingsHash:'f'.repeat(64),wiringHash:'1'.repeat(64),phase:'ready'});
const journal=()=>({group:'g2',binding,routerRevision:'9',configurationHash:binding.configurationHash,complete:false,step:step()});
test('explicit SHA and old hash required; check is read-only',()=>{
  validateRequest({action:'check'});
  assert.throws(()=>validateRequest({action:'check',oldHash}),/Read-only check/);
  assert.throws(()=>validateRequest({action:'upgrade',confirmation:CONFIRMATION,actualCommit:sha,release:sha,oldHash:'wrong'}),/hash/);
  assert.throws(()=>validateRequest({action:'upgrade',confirmation:'UPGRADE GROUP 2',actualCommit:sha,release:sha,oldHash}),/approval/);
  assert.throws(()=>validateRequest({action:'upgrade',confirmation:CONFIRMATION,actualCommit:sha,release:'f'.repeat(40),oldHash}),/SHA/);
  validateRequest({action:'upgrade',confirmation:CONFIRMATION,actualCommit:sha,release:sha,oldHash});
});
test('only pinned mainnet g2 club canister on original subnet permitted',()=>{
  validateTarget(target,provision);
  for(const prop of ['name','groupId','canisterId','subnetId']){
    assert.throws(()=>validateTarget({...target,[prop]:'wrong'},provision));
  }
  assert.throws(()=>validateTarget(target,{...provision,groupId:'g1'}));
  assert.throws(()=>validateTarget(target,{...provision,canisters:{club_domain:'wrong'}}));
  assert.throws(()=>validateTarget(target,{...provision,subnetId:'wrong'}));
});
test('reject mismatched routing group or unregistered canister',()=>{
  const group={id:'g2',target_alias:'mainnet',photo_store:[{toText:()=>provision.dedicatedBlobStore.canisterId}],
    domains:[{domain:'club_domain',canister:{toText:()=>TARGET.canisterId}}]};
  const placement={group_id:'g2',deployment_id:'mainnet',host:'https://icp-api.io',network_kind:'public_mainnet',
    primary_subnet:{toText:()=>subnet},
    domains:[{domain:'club_domain',canister:{toText:()=>TARGET.canisterId},subnet:{toText:()=>subnet}}]};
  validateRegistration(target,[group],[placement],provision);
  assert.throws(()=>validateRegistration(target,[{...group,id:'g1'}],[placement],provision));
  assert.throws(()=>validateRegistration(target,[group],[{...placement,network_kind:'local'}],provision));
  assert.throws(()=>validateRegistration(target,[group],[{...placement,domains:[]}],provision));
});
test('journal receipt is bound to exact target/source/fingerprints',()=>{
  validateJournal(journal(),binding);
  assert.throws(()=>validateJournal({...journal(),complete:true},binding));
  assert.throws(()=>validateJournal({...journal(),step:{...step(),canisterId:'somewhere-else'}},binding));
  assert.throws(()=>validateJournal(journal(),{...binding,release:'z'.repeat(40)}));
  assert.throws(()=>validateJournal({...journal(),step:{...step(),wiringHash:'wrong'}},binding));
});
test('single pending checkpoint precedes exactly one install; readbacks precede completion',async()=>{
  const j=journal(),events=[],current={moduleHash:oldHash,settingsHash:step().settingsHash,
    wiringHash:step().wiringHash,stableBytes:'100',clubs:'3'};
  await executeUpgrade(j,{
    gate:async()=>events.push('gate'),
    observe:async()=>({...current}),
    persist:async()=>events.push('persist:'+j.step.phase+':'+j.complete),
    install:async()=>{events.push('install');current.moduleHash=newHash}
  });
  assert.equal(events.filter(x=>x==='install').length,1);
  assert.ok(events.indexOf('persist:pending:false')<events.indexOf('install'));
  assert.equal(j.complete,true);assert.equal(j.step.phase,'complete');
  assert.ok(events.includes('persist:complete:true'));
});
test('an unknown pending outcome never retries install',async()=>{
  const j=journal();j.step.phase='pending';let installed=0;
  await assert.rejects(executeUpgrade(j,{
    gate:async()=>{},observe:async()=>({moduleHash:oldHash,settingsHash:j.step.settingsHash,wiringHash:j.step.wiringHash}),
    persist:async()=>{},install:async()=>{installed++}
  }),/Unknown upgrade outcome/);
  assert.equal(installed,0);
});
test('settings/wiring drift blocks install; cluster data loss fails closed',async()=>{
  const j=journal();let installed=0;
  await assert.rejects(executeUpgrade(j,{
    gate:async()=>{},observe:async()=>({moduleHash:oldHash,settingsHash:'changed',wiringHash:j.step.wiringHash}),
    persist:async()=>{},install:async()=>{installed++}
  }),/authority\/settings/);
  assert.equal(installed,0);
  const j2=journal(),st={moduleHash:oldHash,settingsHash:j.step.settingsHash,
    wiringHash:j.step.wiringHash,stableBytes:'100',clubs:'3'};
  await assert.rejects(executeUpgrade(j2,{
    gate:async()=>{},observe:async()=>({...st}),
    persist:async()=>{},install:async()=>{st.moduleHash=newHash;st.clubs='0';st.stableBytes='0'}
  }),/stable-memory loss/);
  assert.equal(j2.complete,false);
});
test('runner and workflow cannot stage/install any other services',()=>{
  const runner=readFileSync(new URL('../frontend/scripts/upgrade-g2-club-roster.ts',import.meta.url),'utf8');
  const workflow=readFileSync(new URL('../.github/workflows/g2-club-roster-only-upgrade.yml',import.meta.url),'utf8');
  assert.match(runner,/upgradeArgs\(target,file,GROUP2_GOVERNOR\)/);
  assert.match(runner,/TARGET\.name/);
  assert.doesNotMatch(runner,/executeTwoCanisterUpgrade|notification_queue\.wasm|icp build events_domain|icp build notification_queue/);
  assert.match(workflow,/icp build club_domain/);
  assert.doesNotMatch(workflow,/icp build club_domain notification_queue|icp build notification_queue|icp build club_domain events_domain|upgrade-group2\.mjs/);
  assert.match(workflow,/group-2-admin-controls/);
  assert.match(workflow,/GITHUB_REF.*refs\/heads\/main/);
});
