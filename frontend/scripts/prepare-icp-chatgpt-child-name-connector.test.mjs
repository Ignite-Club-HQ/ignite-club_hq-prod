import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { IbeCiphertext } from '@icp-sdk/vetkeys';
import {
  DEV_CHATGPT_CHILD_TARGET as T,
  parseCandidPublicKey,
  parseCreatedChildId,
  prepareChildNameFromIcpConnector,
} from './prepare-icp-chatgpt-child-name-connector.mjs';

const fixtureKey = Uint8Array.from([
  177,78,48,240,39,234,226,250,163,45,107,185,179,87,249,4,
  113,97,47,2,140,204,166,139,115,233,231,155,126,96,58,13,
  177,58,235,166,72,77,108,230,164,14,171,99,8,189,77,249,
  5,252,123,102,83,62,240,95,130,46,204,29,55,217,215,12,
  228,80,86,157,252,41,64,98,116,136,172,236,41,43,138,10,
  130,223,174,28,225,98,96,53,85,12,213,228,186,91,161,192,
]);
const childId = 'child-own-1-123456789';
const candidKey = '(blob "' + Array.from(fixtureKey, b => '\\' + b.toString(16).padStart(2, '0')).join('') + '",)';
const role = '(vec { record { club = opt "70eccd5e-28cd-54b5-9bbd-d0dc74eea9ca"; role = "club_admin"; team = null; user = principal "' + T.test3Principal + '"; }; record { club = opt "' + T.clubId + '"; role = "parent"; team = opt "' + T.teamId + '"; user = principal "' + T.test3Principal + '"; }; })';
const created = '(variant { Ok = record { club_id = null; id = "' + childId + '"; parent = opt principal "' + T.test3Principal + '"; teams = vec {}; } },)';

function receipt(method, canister_id, reply) {
  return {
    canister_id, method, reply, declared_at:'/.well-known/ic-architecture',
    declared_by:T.appUrl, derived_for_origin:T.derivationOrigin,
    requested:T.derivationOrigin, is_anonymous:false,
  };
}
function fixture() {
  return {
    app: {
      app_url:T.appUrl, derivation_origin:T.derivationOrigin, discovery_error:null,
      canisters:[
        {canister_id:T.clubCanister,declared:true,sources:['ic-architecture','bundle']},
        {canister_id:T.piiCanister,declared:true,sources:['ic-architecture','bundle']},
      ],
    },
    identity: {
      principal:T.test3Principal, requested:T.derivationOrigin,
      derived_for_origin:T.derivationOrigin, read_only:false,
    },
    roleReceipt:receipt('read_account_my_role_grants',T.clubCanister,role),
    childReceipt:receipt('create_own_child',T.clubCanister,created),
    publicKeyReceipt:receipt('pii_vetkey_verification_key',T.piiCanister,candidKey),
    childName:'Ted',
  };
}

test('strict parser accepts exactly one legitimate 96-byte public key', () => {
  assert.deepEqual(parseCandidPublicKey(candidKey), fixtureKey);
  for (const bad of [
    '(blob "' + Array.from(fixtureKey.slice(1), b => '\\' + b.toString(16).padStart(2, '0')).join('') + '",)',
    '(blob "' + candidKey.slice(7, -3) + '", blob "\\00")',
    '("' + fixtureKey.join(',') + '")', '(blob "Ted")',
    candidKey + ' // another value',
  ]) assert.throws(() => parseCandidPublicKey(bad));
});

test('synthetic signed connector responses produce decryptable-format ciphertext and only Candid args', () => {
  const out = prepareChildNameFromIcpConnector(fixture());
  assert.equal(out.childId, childId);
  assert.equal(out.ownerPrincipal, T.test3Principal);
  assert.equal(out.registration.canister_id,T.piiCanister);
  assert.equal(out.registration.method,'register_pii');
  assert(out.registration.args.includes('principal "' + T.test3Principal + '"'));
  assert(out.readback.args.includes('"' + childId + '"'));
  assert(out.clubGrant.args.includes('"' + T.clubId + '"'));
  assert(out.parentGrant.args.includes('principal "' + T.test3Principal + '"'));
  assert.equal(out.assignment.method,'set_own_child_team');
  assert(out.assignment.args.includes('"' + T.teamId + '"'));
  assert(!JSON.stringify(out).includes('Ted'), 'output must never include child name in clear text');

  const blob = /blob "((?:\\[0-9a-f]{2})+)"/.exec(out.registration.args);
  assert(blob, 'Candid ciphertext blob is required');
  const bytes = Uint8Array.from([...blob[1].matchAll(/\\([0-9a-f]{2})/g)].map(x=>parseInt(x[1],16)));
  assert.equal(new TextDecoder().decode(bytes.slice(0,6)), 'IGSK1\n');
  const markerEnd=bytes.indexOf(10,6);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes.slice(6,markerEnd))),
    {k:'clubchildren',s:T.clubId,c:T.clubId});
  assert.doesNotThrow(()=>IbeCiphertext.deserialize(bytes.slice(markerEnd+1)));
});

test('stdio CLI produces the same secure fields without exposing Ted in stdout or stderr', () => {
  const file=fileURLToPath(new URL('./prepare-icp-chatgpt-child-name-cli.mjs',import.meta.url));
  const r=spawnSync(process.execPath,[file],{input:JSON.stringify(fixture()),encoding:'utf8',timeout:15000});
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.stderr,'');
  assert(!r.stdout.includes('Ted'));
  const out=JSON.parse(r.stdout);
  assert.equal(out.childId,childId);
  assert.equal(out.registration.method,'register_pii');

  const bad=spawnSync(process.execPath,[file],{input:'{"childName":"Ted",BAD',encoding:'utf8',timeout:15000});
  assert.equal(bad.status,1);
  assert.equal(bad.stdout,'');
  assert(!bad.stderr.includes('Ted'));
  assert.match(bad.stderr,/Invalid JSON input/);
});

test('reject untrusted manifest, derivation, principal, role, child and key receipts', () => {
  const baseline=fixture();
  const attempts=[
    p => { p.app.app_url='https://ignite-club-launchpad.lovable.app'; },
    p => { p.app.derivation_origin='https://evil.example'; },
    p => { p.app.canisters[1].declared=false; },
    p => { p.app.canisters[1].sources=['bundle']; },
    p => { p.app.canisters.push({...p.app.canisters[1]}); },
    p => { p.identity.principal='2vxsx-fae'; },
    p => { p.identity.read_only=true; },
    p => { p.identity.derived_for_origin='https://evil.example'; },
    p => { p.roleReceipt.declared_by='https://evil.example'; },
    p => { p.roleReceipt.is_anonymous=true; },
    p => { p.roleReceipt.canister_id='mzzzv-taaaa-aaaal-qxlrq-cai'; },
    p => { p.roleReceipt.reply=p.roleReceipt.reply.replace('role = "parent"','role = "member"'); },
    p => { p.roleReceipt.reply=p.roleReceipt.reply.replace('team = opt "' + T.teamId + '"','team = null'); },
    p => { p.childReceipt.reply=p.childReceipt.reply.replace('Ok = record','Err = "not allowed"; Ok = record'); },
    p => { p.childReceipt.reply=p.childReceipt.reply.replace('parent = opt principal "'+T.test3Principal+'"','parent = null'); },
    p => { p.childReceipt.reply=p.childReceipt.reply.replace('teams = vec {}','teams = vec {"other-team"}'); },
    p => { p.childReceipt.reply=p.childReceipt.reply.replace('id = "'+childId+'"','id = "arbitrary"'); },
    p => { p.publicKeyReceipt.method='get_encrypted_pii_batch'; },
    p => { p.publicKeyReceipt.canister_id='iui5p-aaaaa-aaaal-qxllq-cai'; },
    p => { p.publicKeyReceipt.reply='(blob "\\00")'; },
    p => { p.childName=' '; },
    p => { p.childName='T'.repeat(81); },
  ];
  for (const mutate of attempts) {
    const x=structuredClone(baseline);
    mutate(x);
    assert.throws(()=>prepareChildNameFromIcpConnector(x));
  }
});

test('cannot splice an unrelated admin role and unrelated member role into an U10 Parent grant', () => {
  const x=fixture();
  x.roleReceipt.reply='(vec { record { club = opt "' + T.clubId +
    '"; role = "club_admin"; team = null; user = principal "' + T.test3Principal +
    '"; }; record { club = opt "unrelated"; role = "parent"; team = opt "' +
    T.teamId + '"; user = principal "' + T.test3Principal + '"; }; })';
  assert.throws(()=>prepareChildNameFromIcpConnector(x),/Parent/);
});

test('only successful, newly returned unassigned parent-owned child IDs qualify',()=>{
  assert.equal(parseCreatedChildId(created),childId);
  assert.throws(()=>parseCreatedChildId('(variant { Err = "Child quota exceeded" },)'));
  assert.throws(()=>parseCreatedChildId(created.replace('club_id = null','club_id = opt "elsewhere"')));
  assert.throws(()=>parseCreatedChildId(created.replace('teams = vec {}','teams = vec {"elsewhere"}')));
});
