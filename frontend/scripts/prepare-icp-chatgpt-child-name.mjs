/**
 * DEV Group 2 only: prepare a child's encrypted "name" for the existing
 * DFINITY ICP connector, using precisely the same clubchildren IBE audience
 * and IGSK1 envelope as frontend/src/live/piiVetKeys.ts.
 *
 * The host must obtain the public verification key from the pinned, declared
 * Group 2 PII canister, verify the logged-in principal and newly created
 * Group 2 child ID, and request separate approval for each write.
 * This module is offline: NO canister calls, identity delegations or plaintext
 * name writes. Never log the input, return object or generated Candid args.
 *
 * IMPORTANT: do NOT prepare until create_own_child returns the new child ID.
 * On unknown register_pii outcome, read back ciphertext as the original caller
 * before considering a retry; never create a second child to resolve it.
 */
import { Principal } from '@icp-sdk/core/principal';
import { DerivedPublicKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';

export const DEV_GROUP2_PII_CANISTER = 'zt5a6-yiaaa-aaaal-qxp5q-cai';
export const DEV_U10_CLUB_ID = '177f8c01-3617-402a-aedd-5c5c17ccfde1';
export const DEV_U10_TEAM_ID = 'a3e9341e-bc61-4e4d-9ebf-2f2c9f347128';

const encoder = new TextEncoder();
const NAME_FIELD = 'name';
const SHARED_FIELD = 'shared';
const SHARED_MAGIC = encoder.encode('IGSK1\n');

function requirePrincipal(value) {
  const p = Principal.fromText(value);
  if (p.isAnonymous() || p.toText() !== value) throw Error('Invalid canonical caller principal');
  return value;
}

function candidBlob(bytes) {
  return 'blob "' + [...bytes].map(b => '\\' + b.toString(16).padStart(2, '0')).join('') + '"';
}

function candidText(s) {
  return JSON.stringify(s);
}

/**
 * @param {{
 *   childName: string,
 *   childId: string,
 *   callerPrincipal: string,
 *   clubId: string,
 *   teamId: string,
 *   piiCanisterId: string,
 *   verificationKey: Uint8Array
 * }} input
 */
export function prepareEncryptedChatgptChildName(input) {
  // All targets are trusted DEV constants; never redirect private-name writes
  // to a different group, child, club, team or unverified PII key authority.
  if (input.clubId !== DEV_U10_CLUB_ID ||
      input.teamId !== DEV_U10_TEAM_ID ||
      input.piiCanisterId !== DEV_GROUP2_PII_CANISTER) {
    throw Error('Unverified DEV Group 2 child-name target');
  }
  if (typeof input.childId !== 'string' ||
      !/^child-own-[0-9]+-[0-9]+$/.test(input.childId)) {
    throw Error('Verified newly created child ID required');
  }
  const caller = requirePrincipal(input.callerPrincipal);
  const name = input.childName?.trim();
  if (!name || [...name].length > 80 || encoder.encode(name).length > 512) {
    throw Error('Child name must be between 1 and 80 characters (max 512 bytes)');
  }
  if (!(input.verificationKey instanceof Uint8Array) ||
      input.verificationKey.length !== 96) {
    throw Error('Pinned PII canister public verification key (96 bytes) required');
  }

  // Identity, audience header, byte envelope and randomness are identical to
  // encryptSharedValue({kind:"clubchildren",scope:club,club}, name).
  const key = DerivedPublicKey.deserialize(input.verificationKey);
  const audience = 'clubchildren:' + input.clubId;
  const identity = IbeIdentity.fromBytes(encoder.encode(audience + '\u001f' + SHARED_FIELD));
  const encrypted = IbeCiphertext.encrypt(key, identity, encoder.encode(name), IbeSeed.random()).serialize();
  const header = encoder.encode(JSON.stringify({k: 'clubchildren', s: input.clubId, c: input.clubId}) + '\n');
  const ciphertext = new Uint8Array(SHARED_MAGIC.length + header.length + encrypted.length);
  ciphertext.set(SHARED_MAGIC);
  ciphertext.set(header, SHARED_MAGIC.length);
  ciphertext.set(encrypted, SHARED_MAGIC.length + header.length);

  return {
    childId: input.childId,
    piiCanisterId: DEV_GROUP2_PII_CANISTER,
    ciphertext,
    registrationArgs: '(' + candidText(input.childId) + ', ' + candidText(NAME_FIELD) + ', ' +
      candidBlob(ciphertext) + ', principal ' + candidText(caller) + ')',
    clubGrantArgs: '(' + candidText(input.childId) + ', ' + candidText(NAME_FIELD) + ', ' +
      candidText(input.clubId) + ')',
    parentGrantArgs: '(' + candidText(input.childId) + ', ' + candidText(NAME_FIELD) + ', principal ' +
      candidText(caller) + ')',
    readbackArgs: '(vec {' + candidText(input.childId) + '}, ' + candidText(NAME_FIELD) +
      ', "read", "chatgpt_dev_child_name_confirmation")',
  };
}

/** Compare returned/read-back register_pii encrypted record; NEVER plaintext. */
export function matchesEncryptedChatgptChildNameRegistration(record, prepared) {
  if (!record || !prepared?.ciphertext || record.pii_id !== prepared.childId ||
      record.field_id !== NAME_FIELD || record.master_key_id !== 'vetkey-ibe-v1') return false;
  const bytes = Uint8Array.from(record.ciphertext ?? []);
  return bytes.length === prepared.ciphertext.length &&
    bytes.every((n, i) => n === prepared.ciphertext[i]);
}
