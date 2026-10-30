// Real production actor, isolated local replica only.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
const governor = Principal.fromUint8Array(new Uint8Array([1,1]));
const self = Principal.fromUint8Array(new Uint8Array([2,1]));
const other = Principal.fromUint8Array(new Uint8Array([3,1]));
const ok = r => { assert.ok('Ok' in r, r.Err); return r.Ok; };
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl(), { requestTimeoutMs: 180000 });
  const { actor: c } = await pic.setupCanister({ idlFactory, wasm: process.env.COMPETITION_DOMAIN_WASM, sender: governor, controllers: [governor], arg: IDL.encode([IDL.Principal],[governor]) });
  c.setPrincipal(governor);
  for (const [user, role, cup, team] of [[self,'admin','cup',[]],[self,'committee','cup',[]],[self,'admin','cup',['team']],[self,'admin','other',[]],[self,'owner','owner-cup',[]],[other,'admin','cup',[]]]) ok(await c.grant_role(user,role,cup,team));
  const before = ok(await c.export_state()).roles;
  c.setPrincipal(self);
  ok(await c.remove_competition_role('cup',self,'admin',[]));
  assert.ok('Err' in await c.remove_competition_role('owner-cup',self,'owner',[]));
  assert.ok('Err' in await c.remove_competition_role('cup',other,'admin',[]));
  assert.ok('Err' in await c.remove_competition_role('cup',self,'admin',[]));
  c.setPrincipal(governor);
  assert.deepEqual(ok(await c.export_state()).roles,before.filter(r => !(r.user.toText()===self.toText() && r.role==='admin' && r.competition_id==='cup' && r.team_id.length===0)));
  c.setPrincipal(self);
  ok(await c.remove_competition_role('cup',self,'committee',[]));
  console.log('PASS real canister: own non-owner removal, owner denial, unauthorized-other denial, exact team/sibling/other-competition preservation, missing-row denial');
} finally { if(pic) await pic.tearDown(); await server.stop(); }