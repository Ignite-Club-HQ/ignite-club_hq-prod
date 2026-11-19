/**
 * Focused disposable PocketIC rehearsal of the exact DEV first-content release:
 * old shared Identity + old G1/G2 Club -> new Identity -> new G2 Club only.
 * Exercise signed memberships and account continuity. Does not touch mainnet.
 */
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';

for (const key of ['OLD_IDENTITY_ACCESS_WASM','OLD_CLUB_DOMAIN_WASM','IDENTITY_ACCESS_WASM','CLUB_DOMAIN_WASM','POCKET_IC_BIN'])
  if(!process.env[key])throw Error('Exactly four Wasm binaries and the disposable PocketIC runtime are required: '+key);
const principal = value => Principal.fromUint8Array(Uint8Array.from([value,1]));
const governor=principal(1), primary=principal(2), linked=principal(3), outsider=principal(4);
const good = result => { assert.ok(result && 'Ok' in result,JSON.stringify(result,(_,v)=>typeof v==='bigint'?String(v):v)); return result.Ok; };
const clubs = async (group,person) => {
  group.actor.setPrincipal(person);
  return good(await group.actor.read_my_club_memberships_indexed([],100)).clubs;
};
const roles = async (group,person) => {
  group.actor.setPrincipal(person);
  return group.actor.read_account_my_role_grants();
};
const server=await PocketIcServer.start();let pic;
try {
  pic=await PocketIc.create(server.getUrl());
  const identity=await pic.setupCanister({idlFactory:identityIdl,wasm:process.env.OLD_IDENTITY_ACCESS_WASM,
    sender:governor,controllers:[governor],
    environmentVariables:[{name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'}],
    arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
  const groups=[];
  for (const suffix of ['g1','g2']) {
    const c=await pic.setupCanister({idlFactory:clubIdl,wasm:process.env.OLD_CLUB_DOMAIN_WASM,
      sender:governor,controllers:[governor],
      environmentVariables:[
        {name:'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',value:'1'},
        {name:'IGNITE_ACCOUNT_SERVICE_IDENTITY',value:identity.canisterId.toText()}
        // No combined-admission setting: it stays OFF throughout upgrade.
      ],
      arg:IDL.encode([IDL.Principal],[governor])});
    groups.push(c);
  }
  const [g1,g2]=groups;
  identity.actor.setPrincipal(governor);
  good(await identity.actor.set_service_authorities(groups.map(g=>g.canisterId)));
  good(await identity.actor.set_club_authorities(groups.map(g=>g.canisterId)));
  for(const [n,group] of groups.entries()) {
    group.actor.setPrincipal(governor);
    good(await group.actor.create_club(n===0?'persist-g1':'persist-g2','Persistence Club','Persistence Club',[],[]));
    good(await group.actor.add_role_grant(linked,n===0?'persist-g1':'persist-g2','coach',[]));
    good(await group.actor.set_identity_access_canister(identity.canisterId));
  }
  identity.actor.setPrincipal(primary);
  const account=good(await identity.actor.register_account());
  const challenge=good(await identity.actor.begin_link(linked));
  identity.actor.setPrincipal(linked);
  good(await identity.actor.accept_link(challenge.id));
  for(const group of groups) {
    group.actor.setPrincipal(linked);
    good(await group.actor.sync_my_linked_account());
  }
  assert.deepEqual(await clubs(g1,linked),['persist-g1']);
  assert.deepEqual(await clubs(g2,linked),['persist-g2']);
  assert.equal((await roles(g2,linked)).length,1);
  identity.actor.setPrincipal(g2.canisterId);
  assert.equal(good(await identity.actor.read_service_account(linked)).id,account.id);
  // 1) Exact staged Identity update with the original G1 and G2 club code intact.
  await pic.upgradeCanister({canisterId:identity.canisterId,wasm:process.env.IDENTITY_ACCESS_WASM,
    sender:governor,arg:IDL.encode([IDL.Record({governor:IDL.Principal})],[{governor}])});
  assert.deepEqual(await clubs(g1,linked),['persist-g1'],'old G1 Club survives new shared Identity');
  assert.deepEqual(await clubs(g2,linked),['persist-g2'],'old G2 Club survives new shared Identity');
  identity.actor.setPrincipal(g2.canisterId);
  const combined=good(await identity.actor.read_member_admission(linked));
  assert.ok('Eligible' in combined.eligibility.decision);
  assert.equal(combined.account.length,1);
  assert.equal(combined.account[0].id,account.id);
  identity.actor.setPrincipal(outsider);
  assert.ok('Err' in await identity.actor.read_member_admission(linked),
    'outsiders cannot read account aliases');

  // 2) Upgrade G2 Club only, preserving Motoko stable memory. G1 Club stays old.
  await pic.upgradeCanister({canisterId:g2.canisterId,wasm:process.env.CLUB_DOMAIN_WASM,
    sender:governor,arg:IDL.encode([IDL.Principal],[governor]),
    upgradeModeOptions:{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}});
  assert.deepEqual(await clubs(g2,linked),['persist-g2'],'G2 membership survives real old-to-new upgrade');
  assert.equal((await roles(g2,linked)).length,1,'G2 role survives old-to-new upgrade');
  g2.actor.setPrincipal(linked);
  assert.equal(good(await g2.actor.read_account_whoami()).id,account.id,'linked account preserved');
  assert.deepEqual(await clubs(g1,linked),['persist-g1'],'G1 Club remains on previous module');
  g2.actor.setPrincipal(outsider);
  // The protected path may reply with Err, an empty member page or a
  // certified CanisterReject for an unregistered principal.
  let outsiderDenied=false;
  try {
    const outsiderMembership=await g2.actor.read_my_club_memberships_indexed([],100);
    outsiderDenied='Err' in outsiderMembership ||
      ('Ok' in outsiderMembership && outsiderMembership.Ok.clubs.length===0);
  } catch(error) {
    outsiderDenied=/Account admission denied or unavailable/.test(String(error));
  }
  assert.ok(outsiderDenied,'unlinked outsider cannot see the protected G2 club');
  identity.actor.setPrincipal(g2.canisterId);
  const post=good(await identity.actor.read_member_admission(linked));
  assert.ok('Eligible' in post.eligibility.decision);
  assert.equal(post.account[0].id,account.id);
  console.log('PASS: previous Identity/G1/G2 binaries upgraded in correct order; linked-account membership, G2 role and both clubs persist, untrusted reader denied, combined flag OFF, G1 Club unchanged. Disposable PocketIC only.');
} finally {await pic?.tearDown();await server.stop();}
