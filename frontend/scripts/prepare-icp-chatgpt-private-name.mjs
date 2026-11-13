/**
 * Caller-independent, local-only encryption preparation for ChatGPT's
 * existing DFINITY ICP connector. No Internet Identity credentials, network
 * calls, plaintext profile writes or plaintext Github logs.
 *
 * Host integration must obtain the pinned PII canister's PUBLIC verification
 * key through the official connector, then run this code in a trusted local
 * runtime and send the returned Candid argument to that SAME connector,
 * signed as the selected user's Internet Identity. This module never signs.
 */
import { Principal } from '@icp-sdk/core/principal';
import { DerivedPublicKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';

const REFERENCE_PREFIX = 'pii-display-name:v1:';
const FIELD = 'display_name';
const encoder = new TextEncoder();

function canonical(value) {
  const p = Principal.fromText(value);
  if (p.isAnonymous() || p.toText() !== value) throw Error('Invalid canonical principal');
  return value;
}

function candidText(value) {
  return JSON.stringify(value);
}

function candidBlob(bytes) {
  // Textual Candid blob bytes, never a hex string or base64 pretending to be a blob.
  return 'blob "' + [...bytes].map(b => '\\' + b.toString(16).padStart(2, '0')).join('') + '"';
}

/**
 * Encrypts a specifically user-approved display name for the signed-in caller.
 * This is offline IBE encryption using only the PII canister's public key.
 * Neither ciphertext generation nor the output contains delegation material.
 *
 * @param {{displayName:string,callerPrincipal:string,piiAuthority:string,verificationKey:Uint8Array}} input
 * @returns {{reference:string, registrationArgs:string, profileArgs:string, ciphertext:Uint8Array}}
 */
export function prepareEncryptedChatgptProfileName(input) {
  const name = input.displayName?.trim();
  if (!name || [...name].length > 80 || encoder.encode(name).length > 512) {
    throw Error('Display name must be between 1 and 80 characters (max 512 UTF-8 bytes)');
  }
  const subject = canonical(input.callerPrincipal);
  const authority = canonical(input.piiAuthority);
  if (!(input.verificationKey instanceof Uint8Array) || !input.verificationKey.length) {
    throw Error('The verified PII authority public key is required');
  }
  // Key origin MUST be pinned by the caller integration to the declared DEV
  // PII canister, NOT by an untrusted end-user field.
  const publicKey = DerivedPublicKey.deserialize(input.verificationKey);
  const identity = IbeIdentity.fromBytes(encoder.encode(subject + '\u001f' + FIELD));
  const ciphertext = IbeCiphertext.encrypt(publicKey, identity, encoder.encode(name), IbeSeed.random()).serialize();
  const reference = REFERENCE_PREFIX + authority + ':' + subject;
  return {
    reference,
    ciphertext,
    registrationArgs: '(' + candidText(subject) + ', ' + candidText(FIELD) + ', ' + candidBlob(ciphertext) + ', principal ' + candidText(subject) + ')',
    profileArgs: '(' + candidText(reference) + ', null)',
  };
}

/** Do not retry an uncertain register_pii result automatically. Read back
 * the original ciphertext and check the owner/field before publishing ref. */
export function matchesPrivateNameRegistration(reply, subject, ciphertext) {
  return reply?.pii_id === subject && reply?.field_id === FIELD &&
    reply?.master_key_id === 'vetkey-ibe-v1' &&
    reply?.ciphertext && Uint8Array.from(reply.ciphertext).length === ciphertext.length &&
    Uint8Array.from(reply.ciphertext).every((value, idx) => value === ciphertext[idx]);
}
