import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { prepareEncryptedChatgptProfileName, matchesPrivateNameRegistration } from './prepare-icp-chatgpt-private-name.mjs';

const principal='pfslb-rpozk-543m5-zll3a-a3ay4-rdg3b-elojg-ukmfs-e624l-6rjyp-jae';
const authority='iui5p-aaaaa-aaaal-qxllq-cai';
const key = Uint8Array.from([177,78,48,240,39,234,226,250,163,45,107,185,179,87,249,4,113,97,47,2,140,204,166,139,115,233,231,155,126,96,58,13,177,58,235,166,72,77,108,230,164,14,171,99,8,189,77,249,5,252,123,102,83,62,240,95,130,46,204,29,55,217,215,12,228,80,86,157,252,41,64,98,116,136,172,236,41,43,138,10,130,223,174,28,225,98,96,53,85,12,213,228,186,91,161,192]);

test('encrypt an owner name locally, producing only ciphertext arguments', () => {
  const prepared=prepareEncryptedChatgptProfileName({displayName:'Test2',callerPrincipal:principal,piiAuthority:authority,verificationKey:key});
  assert.equal(prepared.reference, `pii-display-name:v1:${authority}:${principal}`);
  assert(prepared.ciphertext.length > 40);
  assert(!prepared.registrationArgs.includes('Test2'));
  assert(!prepared.profileArgs.includes('Test2'));
  assert(prepared.registrationArgs.includes('principal "'+principal+'"'));
  assert(prepared.registrationArgs.includes('blob "'));
  assert(matchesPrivateNameRegistration({
    pii_id:principal,
    field_id:'display_name',
    master_key_id:'vetkey-ibe-v1',
    ciphertext:Array.from(prepared.ciphertext)
  },principal,prepared.ciphertext));
  assert(!matchesPrivateNameRegistration({
    pii_id:'other',
    field_id:'display_name',
    master_key_id:'vetkey-ibe-v1',
    ciphertext:Array.from(prepared.ciphertext)
  },principal,prepared.ciphertext));
});

test('reject empty display name and mismatched/anonymous principals', () => {
  const arg={displayName:'Test2',callerPrincipal:principal,piiAuthority:authority,verificationKey:key};
  assert.throws(()=>prepareEncryptedChatgptProfileName({...arg,displayName:'  '}));
  assert.throws(()=>prepareEncryptedChatgptProfileName({...arg,callerPrincipal:'2vxsx-fae'}));
  assert.throws(()=>prepareEncryptedChatgptProfileName({...arg,piiAuthority:'invalid'}));
});

test('IBE field identity uses the exact existing unit separator and format', () => {
  const source=readFileSync(new URL('./prepare-icp-chatgpt-private-name.mjs',import.meta.url),'utf8');
  assert.match(source,/subject \+ '\\u001f' \+ FIELD/);
  assert.match(source,/IbeSeed\.random\(\)/);
  assert.doesNotMatch(source,/register_account\(/);
});
