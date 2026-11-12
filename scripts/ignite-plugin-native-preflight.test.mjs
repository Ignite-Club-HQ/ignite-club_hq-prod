import test from 'node:test';
import assert from 'node:assert/strict';
import {readNativePluginAccess,DEV_SHARED_CLUB} from './ignite-plugin-native-preflight.mjs';
import {DEV_G2_CLUB,DEV_IDENTITY,DEV_ROUTER} from './ignite-plugin-discovery-parity.mjs';

const p='test-principal-1';
const identity={getPrincipal:()=>({toText:()=>p})};
const account={id:'account-1',status:{Active:null},principals:[{toText:()=>p}]};
const manifest={canisters:[DEV_IDENTITY,DEV_ROUTER,DEV_SHARED_CLUB,DEV_G2_CLUB].map(id=>({id}))};
const grant={role:'club_admin',club:['club-one'],team:[],user:{toText:()=>p}};
const sig={argTypes:[],retTypes:[{display:()=> 'vec RoleGrant'}],annotations:['query']};
const twin={argTypes:[],retTypes:[{display:()=> 'vec RoleGrant'}],annotations:[]};
const service={_fields:[['my_role_grants',sig],['read_account_my_role_grants',twin]]};
const accountReader={whoami:async()=>({Ok:account})};
const makeActors=behaviors=>async(id,givenIdentity)=>{
  assert.equal(givenIdentity,identity,'must retain exact source identity instance');
  return {service,actor:{
    my_role_grants:async()=>behaviors[id]?.legacy?.() ?? [grant],
    read_account_my_role_grants:async()=>behaviors[id]?.protected?.() ?? [grant],
  }};
};
const run=(extras={})=>readNativePluginAccess({
  identity,identityAccess:accountReader,manifest,
  createClubActor:makeActors({}),...extras,
});

test('both native groups yield caller-scoped roles through exact shared identity',async()=>{
  const result=await run();
  assert.equal(result.principal,p);
  assert.equal(result.identityVerified,true);
  assert.equal(result.complete,true);
  assert.equal(result.roles.length,2);
  assert.deepEqual(result.roles.map(g=>g.group),['base','g2']);
});

test('protected legacy trap automatically invokes only the exact read_account twin',async()=>{
  let calls=[];
  const createClubActor=makeActors({
    [DEV_G2_CLUB]:{
      legacy:()=>{calls.push('legacy');throw Error('Use protected consensus account read');},
      protected:()=>{calls.push('protected');return [{...grant,club:['g2-club']}]},
    },
  });
  const result=await run({createClubActor});
  assert.deepEqual(calls,['legacy','protected']);
  assert.equal(result.complete,true);
  assert.equal(result.roles.find(r=>r.group==='g2').club,'g2-club');
});

test('same-principal group admission denial is NOT interpreted as empty clubs',async()=>{
  const result=await run({createClubActor:makeActors({
    [DEV_G2_CLUB]:{
      legacy:()=>{throw Error('Use protected consensus account read')},
      protected:()=>{throw Error('Account admission denied or unavailable')},
    },
  })});
  assert.equal(result.complete,false);
  assert.equal(result.roles,null);
  assert.equal(result.groups.find(g=>g.group==='g2').status,'admission_unavailable');
  assert.equal(result.groups.find(g=>g.group==='base').status,'available');
});

test('missing G2 manifest declaration is explicit not_declared, not empty memberships',async()=>{
  const result=await run({manifest:{canisters:manifest.canisters.filter(c=>c.id!==DEV_G2_CLUB)}});
  assert.equal(result.complete,false);
  assert.equal(result.roles,null);
  assert.equal(result.groups.find(g=>g.group==='g2').status,'not_declared');
});

test('unexpected replica failure is a group read failure and cannot grant access',async()=>{
  const result=await run({createClubActor:makeActors({
    [DEV_G2_CLUB]:{legacy:()=>{throw Error('unexpected replica failure')}},
  })});
  assert.equal(result.complete,false);
  assert.equal(result.roles,null);
  assert.equal(result.groups.find(g=>g.group==='g2').status,'read_failed');
});

test('anonymous or mismatched/erased/suspended II principal is rejected before any group calls',async()=>{
  let calls=0;
  const createClubActor=async()=>{calls++;throw Error('must not call')};
  const cases=[
    {identity:{getPrincipal:()=>({toText:()=> '2vxsx-fae'})},identityAccess:accountReader},
    {identity,identityAccess:{whoami:async()=>({Err:'Account missing'})}},
    {identity,identityAccess:{whoami:async()=>({Ok:{...account,status:{Suspended:null}}})}},
    {identity,identityAccess:{whoami:async()=>({Ok:{...account,principals:[{toText:()=> 'foreign'}]}})}},
  ];
  for(const item of cases) await assert.rejects(run({...item,createClubActor}));
  assert.equal(calls,0);
});

test('invalid or duplicated group inventory fails before constructing group actors',async()=>{
  let calls=0;
  await assert.rejects(run({groupCanisters:{base:DEV_SHARED_CLUB,g2:DEV_SHARED_CLUB},
    createClubActor:async()=>{calls++;throw Error('unexpected')}}),/Invalid group inventory/);
  assert.equal(calls,0);
});

test('missing exact protected twin cannot silently elevate or fabricate roles',async()=>{
  const createClubActor=async id=>({
    service:{_fields:[['my_role_grants',sig]]},
    actor:{my_role_grants:async()=>id===DEV_G2_CLUB
      ? Promise.reject(Error('Use protected consensus account read'))
      : [grant]},
  });
  const result=await run({createClubActor});
  assert.equal(result.complete,false);
  assert.equal(result.groups.find(g=>g.group==='g2').status,'admission_unavailable');
  assert.equal(result.roles,null);
});
