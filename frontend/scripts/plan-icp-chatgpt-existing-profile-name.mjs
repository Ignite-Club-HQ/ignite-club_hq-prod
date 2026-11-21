/**
 * DEV-only, strictly read-only decision after the official DFINITY connector
 * independently verifies the selected user's principal, get_profile reply
 * and a signed, caller-authorized get_encrypted_pii_batch result.
 *
 * No new encryption scheme, signing, key handling, plaintext or canister call
 * occurs here. Never take these normalized inputs from a chat message or an
 * unverified JSON receipt; the host must map real tool results in memory.
 */
import { Principal } from '@icp-sdk/core/principal';
import { DEV_PROFILE_TARGET } from './prepare-icp-chatgpt-profile-name-connector.mjs';

const T = DEV_PROFILE_TARGET;
const fail = () => { throw new Error('Private-name preflight refused; no profile write permitted'); };
function canonical(value) {
  if (typeof value !== 'string') return fail();
  try {
    const p = Principal.fromText(value);
    if (p.isAnonymous() || p.toText() !== value) fail();
  } catch { fail(); }
  return value;
}
function verifiedCiphertext(record, caller) {
  if (!record || record.pii_id !== caller || record.field_id !== 'display_name' ||
      record.master_key_id !== 'vetkey-ibe-v1') fail();
  const bytes = record.ciphertext;
  if (!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) fail();
  if (bytes.length === 0 || bytes.length > 4096 ||
      Array.from(bytes).some(n => !Number.isInteger(n) || n < 0 || n > 255)) fail();
}
/**
 * @param {{
 *   appUrl:string,derivationOrigin:string,callerPrincipal:string,piiCanister:string,
 *   savedProfileName:string|null,encryptedRecordRead:{
 *     status:'found'|'absent'|'denied'|'error',record?:{
 *       pii_id:string,field_id:string,master_key_id:string,ciphertext:number[]|Uint8Array
 *     }
 *   }
 * }} input
 * @returns {{status:'REUSE_ENCRYPTED'|'RESUME_REFERENCE'|'ENCRYPT_NEW',
 *   reference:string,registerPiiRequired:boolean,profileWriteRequired:boolean,
 *   decryptionVerificationRequired:boolean}}
 */
export function planOwnNameReuse(input) {
  if (!input || (input.appUrl !== T.app && input.appUrl !== T.legacyApp) ||
      input.derivationOrigin !== T.origin || input.piiCanister !== T.pii) fail();
  const caller = canonical(input.callerPrincipal);
  const reference = `pii-display-name:v1:${T.pii}:${caller}`;
  const existing = input.savedProfileName;
  // Never silently treat unknown/denied private-data reads as a missing name.
  if (existing != null && typeof existing !== 'string') fail();
  const read = input.encryptedRecordRead;
  if (!read || (read.status !== 'found' && read.status !== 'absent')) fail();
  if (read.status === 'found') {
    verifiedCiphertext(read.record, caller);
    if (existing === reference) {
      return {status:'REUSE_ENCRYPTED',reference,registerPiiRequired:false,
        profileWriteRequired:false,decryptionVerificationRequired:false};
    }
    if (existing == null || existing === '') {
      // An interrupted original signed write is not permission to encrypt
      // again. Verify the existing name by authorized local decryption first.
      return {status:'RESUME_REFERENCE',reference,registerPiiRequired:false,
        profileWriteRequired:true,decryptionVerificationRequired:true};
    }
    fail(); // Existing name is plaintext or foreign/legacy authority.
  }
  if (read.record != null) fail();
  if (existing != null && existing !== '') fail();
  // Only this branch needs the existing offline @icp-sdk/vetkeys encryption.
  return {status:'ENCRYPT_NEW',reference,registerPiiRequired:true,
    profileWriteRequired:true,decryptionVerificationRequired:true};
}
