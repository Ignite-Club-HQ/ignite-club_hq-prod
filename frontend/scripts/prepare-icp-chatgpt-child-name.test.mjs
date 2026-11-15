import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { IbeCiphertext } from '@icp-sdk/vetkeys';
import {
  DEV_GROUP2_PII_CANISTER, DEV_U10_CLUB_ID, DEV_U10_TEAM_ID,
  prepareEncryptedChatgptChildName, matchesEncryptedChatgptChildNameRegistration
} from './prepare-icp-chatgpt-child-name.mjs';

const caller = 'mfmwy-tuspw-6ikuj-mfaqb-le2p3-ndi4w-a5caq-cwcit-xhnob-lidne-fae';
const child = 'child-own-1-123456789';
const key = Uint8Array.from([177,78,48,240,39,234,226,250,163,45,107,185,179,87,249,4,113,97,47,2,140,204,166,139,115,233,231,155,126,96,58,13,177,58,235,166,72,77,108,230,164,14,171,99,8,189,77,249,5,252,123,102,83,62,240,95,130,46,204,29,55,217,215,12,228,80,86,157,252,41,64,98,116,136,172,236,41,43,138,10,130,223,174,28,225,98,96,53,85,12,213,228,186,91,161,192]);
const input = {
  childName: 'Ted', childId: child, callerPrincipal: caller,
  clubId: DEV_U10_CLUB_ID, teamId: DEV_U10_TEAM_ID,
  piiCanisterId: DEV_GROUP2_PII_CANISTER, verificationKey: key
};

test('produces correct clubchildren ciphertext envelope and caller-owned registration arguments', () => {
  const p = prepareEncryptedChatgptChildName(input);
  const bytes = p.ciphertext;
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'IGSK1\n');
  const end = bytes.indexOf(10, 6);
  assert(end > 6);
  const audience = JSON.parse(new TextDecoder().decode(bytes.subarray(6, end)));
  assert.deepEqual(audience, {k:'clubchildren', s:DEV_U10_CLUB_ID, c:DEV_U10_CLUB_ID});
  assert.doesNotThrow(() => IbeCiphertext.deserialize(bytes.subarray(end + 1)));
  assert(!p.registrationArgs.includes('Ted'));
  assert(p.registrationArgs.includes('principal "' + caller + '"'));
  assert(p.registrationArgs.includes('blob "'));
  assert.equal(p.piiCanisterId, DEV_GROUP2_PII_CANISTER);
  assert.equal(p.clubGrantArgs, '("' + child + '", "name", "' + DEV_U10_CLUB_ID + '")');
  assert.equal(p.parentGrantArgs, '("' + child + '", "name", principal "' + caller + '")');
  assert(p.readbackArgs.includes(child));

  const record = {pii_id:child,field_id:'name',master_key_id:'vetkey-ibe-v1',ciphertext:Array.from(bytes)};
  assert(matchesEncryptedChatgptChildNameRegistration(record,p));
  assert(!matchesEncryptedChatgptChildNameRegistration({...record,pii_id:'unrelated-child'},p));
  assert(!matchesEncryptedChatgptChildNameRegistration({...record,field_id:'email'},p));
  assert(!matchesEncryptedChatgptChildNameRegistration({...record,ciphertext:Array.from(bytes).slice(1)},p));
});

test('fail-closed target, authority, identity, name and verification-key checks', () => {
  const invalid = [
    {clubId:'other-club'},
    {teamId:'other-team'},
    {piiCanisterId:'iui5p-aaaaa-aaaal-qxllq-cai'}, // Group 1 cannot stand in for Group 2
    {callerPrincipal:'2vxsx-fae'},
    {callerPrincipal:'bad-principal'},
    {childId:'child-own-2-1\n'},
    {childId:'other-child'},
    {childName:'  '},
    {childName:'x'.repeat(81)},
    {verificationKey:new Uint8Array(0)},
    {verificationKey:new Uint8Array(95)},
  ];
  for (const data of invalid) {
    assert.throws(() => prepareEncryptedChatgptChildName({...input,...data}), JSON.stringify(Object.keys(data)));
  }
});

test('shared IBE identity and envelope remain aligned with the existing live app', () => {
  const source = readFileSync(new URL('../src/live/piiVetKeys.ts', import.meta.url), 'utf8');
  const helper = readFileSync(new URL('./prepare-icp-chatgpt-child-name.mjs', import.meta.url), 'utf8');
  const vault = readFileSync(new URL('../src/live/features/vault.ts', import.meta.url), 'utf8');
  assert.match(source, /const SHARED_MAGIC = textEncoder\.encode\('IGSK1\\n'\)/);
  assert.match(source, /const SHARED_FIELD = 'shared'/);
  assert.match(source, /return \x60\$\{a\.kind\}:\$\{a\.scope\}\x60/);
  assert.match(helper, /'clubchildren:' \+ input\.clubId/);
  assert.match(helper, /IbeSeed\.random\(\)/);
  assert.match(vault, /childId, "name", textEncoder\.encode\(childName\)/);
  assert.doesNotMatch(helper, /register_account\(|create_own_child\(|set_own_child_team\(/);
});
