// This is an isolated, synthetic onboarding rehearsal. PocketIC never calls
// live DEV/PROD and all identities and canisters are discarded at teardown.
// It tests the existing Candid surface; it does not emulate a ChatGPT user
// granting II access or the app's encrypted-name/club-routing release gates.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';

const id = n => Principal.fromUint8Array(Uint8Array.of(n, 1));
const governor = id(1), creator = id(2), invitee = id(3), outsider = id(4);
const ok = result => {
  assert.ok('Ok' in result, 'Expected Ok, received ' + JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  return result.Ok;
};
const optional = ['age_group','deleted_at_ms','description','division','folder_id',
  'gender','logo_url','playhq_competition_id','playhq_team_id','shell_claim_token',
  'shell_claimed_at_ms','shell_claimed_by','shell_contact_email',
  'shell_contact_name','shell_invited_by','team_type'];
const team = (teamId, clubId, name) => {
  const row = {id:teamId,club_id:clubId,name,archived:false,is_active:true,
    is_shell:false,playhq_auto_create_events:false};
  for (const field of optional) row[field] = [];
  return row;
};
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl());
  const identity = await pic.setupCanister({
    idlFactory: identityIdl,
    wasm: process.env.IDENTITY_ACCESS_WASM,
    sender: governor, controllers: [governor],
    arg: IDL.encode([IDL.Record({governor: IDL.Principal})], [{governor}])
  });
  const club = await pic.setupCanister({
    idlFactory: clubIdl,
    wasm: process.env.CLUB_DOMAIN_WASM,
    sender: governor, controllers: [governor],
    arg: IDL.encode([IDL.Principal], [governor])
  });

  // A first-time principal is not an existing Ignite account.
  identity.actor.setPrincipal(creator);
  assert.ok('Err' in await identity.actor.whoami());
  const coachAccount = ok(await identity.actor.register_account());
  assert.equal(ok(await identity.actor.register_account()).id, coachAccount.id,
    'register_account must be idempotent');
  assert.equal(ok(await identity.actor.whoami()).id, coachAccount.id);
  assert.ok('Err' in await identity.actor.get_profile(),
    'Registering a principal does not automatically finish profile setup');
  assert.deepEqual(ok(await identity.actor.my_terms_acceptance()), [],
    'An unaccepted policy must not be invented by onboarding');
  assert.equal(ok(await identity.actor.set_profile('Synthetic Coach', [])).display_name,
    'Synthetic Coach');
  assert.equal(ok(await identity.actor.set_terms_acceptance(1)).terms_version, 1);
  assert.equal(ok(await identity.actor.my_terms_acceptance())[0].terms_version, 1);

  // Club creation must be caller-scoped and yield the creator a club-admin role.
  club.actor.setPrincipal(creator);
  const clubId = '00000000-0000-4000-8000-000000001101';
  const teamId = '00000000-0000-4000-8000-000000001102';
  const madeClub = ok(await club.actor.create_club(clubId, 'Synthetic Cricket Club',
    'synthetic-cricket', [], ['cricket']));
  assert.equal(madeClub.id, clubId);
  assert.equal(ok(await club.actor.read_my_club_memberships_indexed([], 100)).clubs.includes(clubId), true);
  assert.ok('Err' in await club.actor.create_club(clubId, 'Duplicate', 'duplicate', [], []));
  ok(await club.actor.set_club_home_country(clubId, 'AU'));
  assert.deepEqual(ok(await club.actor.get_club_home_countries([clubId])), [[clubId, 'AU']]);

  const madeTeam = ok(await club.actor.save_team(team(teamId, clubId, 'Under 12')));
  assert.equal(madeTeam.club_id, clubId);
  assert.equal(ok(await club.actor.get_team(teamId))[0].name, 'Under 12');
  assert.equal(typeof await club.actor.getApiDoc(), 'string');
  assert.match(await club.actor.getApiDoc(), /ChatGPT onboarding/);

  club.actor.setPrincipal(outsider);
  assert.ok('Err' in await club.actor.create_team_invite_link(clubId, teamId, 'parent'));
  assert.ok('Err' in await club.actor.save_team(team(teamId, clubId, 'Hacked')),
    'A stranger must not overwrite a team they do not own');

  // Authorised invite creation and independent new-user acceptance.
  club.actor.setPrincipal(creator);
  assert.ok('Err' in await club.actor.create_team_invite_link(clubId, teamId, 'club_admin'),
    'Invite links must not grant arbitrary club-admin roles');
  const link = ok(await club.actor.create_team_invite_link(clubId, teamId, 'parent'));
  assert.match(link.token, /^tok-[a-f0-9]{32}$/);
  club.actor.setPrincipal(Principal.anonymous());
  assert.equal(ok(await club.actor.get_team_invite_link_by_token(link.token)).team_id, teamId);

  identity.actor.setPrincipal(invitee);
  assert.ok('Err' in await identity.actor.whoami());
  const parentAccount = ok(await identity.actor.register_account());
  assert.notEqual(parentAccount.id, coachAccount.id);
  assert.equal(ok(await identity.actor.set_profile('Synthetic Parent', [])).display_name,
    'Synthetic Parent');
  assert.deepEqual(ok(await identity.actor.my_terms_acceptance()), []);
  ok(await identity.actor.set_terms_acceptance(1));
  club.actor.setPrincipal(invitee);
  ok(await club.actor.accept_team_invite_link(link.token));
  ok(await club.actor.accept_team_invite_link(link.token));
  assert.equal(ok(await club.actor.read_my_club_memberships_indexed([], 100)).clubs.includes(clubId), true);

  // Existing personal-team creation works; clubless invitations are still denied.
  club.actor.setPrincipal(creator);
  const personalId = '00000000-0000-4000-8000-000000001103';
  ok(await club.actor.save_team(team(personalId, '', 'Personal Under 10')));
  assert.equal(ok(await club.actor.list_my_personal_teams()).some(t => t.id === personalId), true);
  assert.ok('Err' in await club.actor.create_team_invite_link('', personalId, 'parent'),
    'Personal-team invite permission must not be silently bypassed');
  club.actor.setPrincipal(outsider);
  assert.ok('Err' in await club.actor.save_team(team(personalId, '', 'Stolen Team')));
  assert.equal(ok(await club.actor.list_my_personal_teams()).length, 0);

  console.log('PASS: isolated first-time account, profile, explicit terms, club ownership, country, team, parent invite/acceptance, stranger denial, duplicate safety, and personal-team invite hold. Not a live ChatGPT/II or secure-name/placement acceptance.');
} finally {
  await pic?.tearDown();
  await server.stop();
}
