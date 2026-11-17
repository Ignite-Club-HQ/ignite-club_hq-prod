// Local-only PocketIC regression: a soft-deleted team must not retain club
// membership or shared-name audience access. Never connects to a live canister.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {PocketIc,PocketIcServer} from '@dfinity/pic';
import {IDL} from '@icp-sdk/core/candid';
import {Principal} from '@icp-sdk/core/principal';
import {idlFactory} from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';

const root=resolve(import.meta.dirname,'../..');
const wasm=process.env.CLUB_DOMAIN_WASM || resolve(root,'backend/club_domain/.mops/.build/club_domain.wasm');
const principal=n=>Principal.fromUint8Array(Uint8Array.from([n,1]));
const governor=principal(1), parent=principal(2), guardian=principal(3), separateMember=principal(4), outsider=principal(5);
const ok=r=>{assert.ok(r&&'Ok' in r,String(r?.Err));return r.Ok;};
const team=(id,club_id)=>({
  id,club_id,name:id,archived:false,is_active:true,is_shell:false,
  playhq_auto_create_events:false,age_group:[],deleted_at_ms:[],
  description:[],division:[],folder_id:[],gender:[],logo_url:[],
  playhq_competition_id:[],playhq_team_id:[],shell_claim_token:[],
  shell_claimed_at_ms:[],shell_claimed_by:[],shell_contact_email:[],
  shell_contact_name:[],shell_invited_by:[],team_type:[],
});
const server=await PocketIcServer.start({binPath:process.env.POCKET_IC_BIN});
let pic;
try{
  pic=await PocketIc.create(server.getUrl());
  const f=await pic.setupCanister({
    idlFactory,wasm,sender:governor,controllers:[governor],
    arg:IDL.encode([IDL.Principal],[governor]),
  });
  const a=f.actor;a.setPrincipal(governor);
  for(const club of ['club-a','club-b'])ok(await a.create_club(club,club,club,[],[]));
  for(const [id,club] of [['team-a','club-a'],['team-b','club-b']])ok(await a.save_team(team(id,club)));
  // A team-only Parent grant must cease authorizing the club on deletion.
  ok(await a.add_role_grant(parent,'club-a','parent',['team-a']));
  ok(await a.add_role_grant(separateMember,'club-b','player',['team-b']));
  assert.equal(await a.read_has_club_membership(parent,'club-a'),true);
  assert.equal(await a.read_has_club_staff_role(parent,'club-a'),true);
  assert.equal(await a.read_has_club_membership(outsider,'club-a'),false);
  a.setPrincipal(parent);
  assert.ok(ok(await a.read_my_club_memberships(0n,100)).clubs.includes('club-a'));
  a.setPrincipal(governor);
  // A legacy ACL shadow must not resurrect a deleted modern team.
  const before=ok(await a.export_acl());
  ok(await a.replace_acl(before.acl_version,{
    ...before.acl,
    teams:[...before.acl.teams,{id:'team-a',club:'club-a'}],
    children:[...before.acl.children,{
      id:'family-only-child',parent:[guardian],club_id:['club-a'],teams:['team-a'],
    }],
  }));
  assert.equal(await a.read_has_club_membership(guardian,'club-a'),true);
  ok(await a.soft_delete_team('team-a'));
  assert.equal(await a.read_has_club_membership(parent,'club-a'),false,
    'Deleted team-only role cannot grant private club access');
  assert.equal(await a.read_has_club_staff_role(parent,'club-a'),false,
    'Deleted team-only role cannot grant club private-name access');
  assert.equal(await a.read_has_club_membership(guardian,'club-a'),false,
    'Deleted child-team link cannot grant family club access');
  assert.equal(await a.read_has_club_membership(separateMember,'club-b'),true,
    'Active membership in another club remains intact');
  a.setPrincipal(parent);
  assert.ok(!ok(await a.read_my_club_memberships(0n,100)).clubs.includes('club-a'));
  a.setPrincipal(governor);
  // Restoring the team reactivates historical grants without rewriting them.
  ok(await a.restore_team('team-a'));
  assert.equal(await a.read_has_club_membership(parent,'club-a'),true);
  assert.equal(await a.read_has_club_membership(guardian,'club-a'),true);
  // An independent direct club role is unaffected by a team soft-delete.
  ok(await a.add_role_grant(parent,'club-a','member',[]));
  ok(await a.soft_delete_team('team-a'));
  assert.equal(await a.read_has_club_membership(parent,'club-a'),true);
  assert.equal(await a.read_has_club_membership(guardian,'club-a'),false);
  console.log('PASS: deleted team grants and family links denied, legacy shadow cannot revive, restore and independent roles remain valid');
}finally{
  if(pic)await pic.tearDown();
  await server.stop();
}
