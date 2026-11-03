import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runProtectionCommissioning} from './prod-protection-runner.mjs';
import {commissioningFixture,JOBS} from './prod-protection-runner-fixture.mjs';
import {main} from './prod-protection-live.mjs';
const run=(f,job)=>runProtectionCommissioning(f.runtime(job));
async function through(f,last='deliver-protection'){
  await run(f,'plan');for(const job of JOBS){await run(f,job);if(job===last)break;}
}
test('held live entry point never creates live transport for isolated verification',async()=>{
  await assert.rejects(main(),/no live execution/);
  await assert.rejects(runProtectionCommissioning(),/Explicit commissioning runtime/);
});
test('actual runner performs plan and all seven jobs with real Candid, signatures and certified evidence',async()=>{
  const f=commissioningFixture();await through(f);
  assert.equal(f.receipt().phase,'verified');assert.equal(f.receipt().identityUpgradeSkipped,true);
  assert.equal(f.counters.identityUpgrade,0);assert.equal(f.counters.authorization,1);assert.equal(f.counters.inventory,1);
  assert.equal(f.receipt().rows.length,28);assert.equal(f.targets.filter(t=>t.human).length,24);
  assert.equal(f.receipt().subjectBaselineVerified,true);assert.equal(f.page.groups.every(g=>!g.accepting),true);
  assert.equal(f.written.join('').includes(f.sentinel),false);assert.equal(JSON.stringify([...f.store.values()]).includes(f.sentinel),false);
  for(const t of f.targets.filter(t=>t.human))assert.equal(f.settings.get(t.id).find(r=>r.name==='PRIVATE_TEST_SETTING').value,f.sentinel);
  const calls=f.counters.finalReadback;await run(f,'deliver-protection');assert.equal(f.counters.finalReadback,calls+1);assert.equal(f.counters.authorization,1);
});
test('first preparation upgrades original identity once, never a foreign program',async()=>{
  const f=commissioningFixture({alreadyInstalled:false});await through(f,'prepare');assert.equal(f.counters.identityUpgrade,1);
  const foreign=commissioningFixture();await run(foreign,'plan');foreign.modules.set(foreign.safeguard.identity,'f'.repeat(64));
  await assert.rejects(run(foreign,'prepare'),/Identity program differs/);assert.equal(foreign.receipt(),undefined);
});
test('actual runner retries failed final readback without sending approval twice',async()=>{
  const f=commissioningFixture();await through(f,'recovery-protection');f.failFinalOnce();
  await assert.rejects(run(f,'deliver-protection'),/interrupted final readback/);assert.equal(f.receipt().phase,'protection-delivered');
  await run(f,'deliver-protection');assert.equal(f.receipt().phase,'verified');assert.equal(f.counters.authorization,1);assert.equal(f.counters.finalReadback,2);
});
test('authorization completion loss reconciles retained intent then executes final readback',async()=>{
  const f=commissioningFixture();await through(f,'recovery-protection');f.crashCommit('authorization:protection');
  await assert.rejects(run(f,'deliver-protection'),/acknowledgement lost/);assert.equal(f.receipt().pending.kind,'authorization:protection');
  await run(f,'deliver-protection');assert.equal(f.receipt().phase,'verified');assert.equal(f.receipt().pending,null);assert.equal(f.counters.authorization,1);
});
test('inventory completion loss resumes into fresh protection review, not a second provisioning',async()=>{
  const f=commissioningFixture();await through(f,'recovery-inventory');f.crashCommit('inventory:inventory');
  await assert.rejects(run(f,'deliver-inventory'),/acknowledgement lost/);await run(f,'deliver-inventory');
  assert.equal(f.receipt().phase,'protection-reviewed');assert.equal(f.receipt().historyRevision,'1');assert.equal(f.counters.inventory,1);
  assert.ok(f.receipt().inventoryStage.proofs);
});
test('fresh verification refuses disarmed subject protection despite retained global approval',async()=>{
  const f=commissioningFixture();await through(f);f.disarmSubjects();
  await assert.rejects(run(f,'deliver-protection'),/Canister refused/);assert.equal(f.counters.authorization,1);
});
test('fresh runtime invocation resumes every completed signing stage without replacing later proofs',async()=>{
  const f=commissioningFixture();await run(f,'plan');
  for(const job of JOBS.slice(0,-1)){
    await run(f,job);const before=JSON.stringify(f.receipt());
    await run(f,job);assert.equal(JSON.stringify(f.receipt()),before,job);
  }
  await run(f,'deliver-protection');assert.equal(f.receipt().phase,'verified');assert.equal(f.counters.authorization,1);
});
test('process loss after authorization commit resumes final check and leaves approval single-submitted',async()=>{
  const f=commissioningFixture();await through(f,'recovery-protection');f.crashAfter('protection-delivered');
  await assert.rejects(run(f,'deliver-protection'),/process lost/);assert.equal(f.receipt().phase,'protection-delivered');
  await run(f,'deliver-protection');assert.equal(f.receipt().phase,'verified');assert.equal(f.counters.authorization,1);
});