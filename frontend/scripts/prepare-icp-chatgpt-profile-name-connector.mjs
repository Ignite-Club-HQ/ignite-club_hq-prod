/**
 * Offline, DEV-only preparation for a new user's own secure profile name.
 * All authority evidence must be independently obtained from the official
 * DFINITY connector in the SAME authenticated session. This is not a signer.
 */
import { Principal } from '@icp-sdk/core/principal';
import { prepareEncryptedChatgptProfileName } from './prepare-icp-chatgpt-private-name.mjs';

export const DEV_PROFILE_TARGET = Object.freeze({
  app: 'https://proe7-kqaaa-aaaas-qg6gq-cai.icp.net',
  // The historical .icp0.io gateway remains a permitted alias only when the
  // connector freshly declares the same exact origin AND canister manifest.
  legacyApp: 'https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io',
  origin: 'https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app',
  identity: 'mq2sj-fiaaa-aaaal-qxlqa-cai',
  pii: 'iui5p-aaaaa-aaaal-qxllq-cai',
});

function principal(value) {
  if (typeof value !== 'string') throw Error('Refused');
  const parsed = Principal.fromText(value);
  if (parsed.isAnonymous() || parsed.toText() !== value) throw Error('Refused');
  return value;
}
function requireExact(value, expected) {
  if (value !== expected) throw Error('Refused');
}
function requireKey(value) {
  if (!Array.isArray(value) || value.length !== 96 ||
      value.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw Error('Refused');
  }
  return Uint8Array.from(value);
}
/**
 * Input is a local, in-memory envelope assembled after verifying genuine
 * connector responses, NOT evidence that a caller can authenticate.
 * The executor MUST verify every assertion against fresh connector calls,
 * rather than accepting claims supplied in chat or an untrusted JSON file.
 */
export function prepareOwnProfileFromVerifiedIcp(input) {
  if (!input || typeof input !== 'object') throw Error('Refused');
  const { app, identity, authority, name } = input;
  if (!app || !identity || !authority || !name) throw Error('Refused');
  if (![DEV_PROFILE_TARGET.app, DEV_PROFILE_TARGET.legacyApp].includes(app.app_url)) throw Error('Refused');
  // Input evidence is not trusted merely because this local adapter accepts
  // it: the host must match fresh official connector responses, same link and
  // session, before invoking this helper or submitting any signed write.
  requireExact(app.derivation_origin, DEV_PROFILE_TARGET.origin);
  if (!Array.isArray(app.canisters) ||
      !app.canisters.some(c => c.canister_id === DEV_PROFILE_TARGET.identity &&
        c.declared === true && c.sources?.includes('ic-architecture')) ||
      !app.canisters.some(c => c.canister_id === DEV_PROFILE_TARGET.pii &&
        c.declared === true && c.sources?.includes('ic-architecture'))) throw Error('Refused');
  requireExact(identity.requested, DEV_PROFILE_TARGET.origin);
  requireExact(identity.derived_for_origin, DEV_PROFILE_TARGET.origin);
  if (identity.read_only !== false) throw Error('Refused');
  const caller = principal(identity.principal);
  requireExact(authority.identity_canister, DEV_PROFILE_TARGET.identity);
  requireExact(authority.pii_canister, DEV_PROFILE_TARGET.pii);
  requireExact(principal(authority.owner_principal), caller);
  requireExact(name.confirmed_by_user, true);
  if (typeof name.value !== 'string' || /[\u0000-\u001f\u007f]/u.test(name.value))
    throw Error('Refused');
  const key = requireKey(authority.verification_key);
  const prepared = prepareEncryptedChatgptProfileName({
    displayName: name.value, callerPrincipal: caller,
    piiAuthority: DEV_PROFILE_TARGET.pii, verificationKey: key,
  });
  return {
    environment: 'DEV', pii_canister: DEV_PROFILE_TARGET.pii,
    identity_canister: DEV_PROFILE_TARGET.identity,
    caller_principal: caller,
    reference: prepared.reference,
    register_pii_args: prepared.registrationArgs,
    set_profile_args: prepared.profileArgs,
    required_verification: 'Signed register_pii, owner ciphertext readback and local decryption before one signed set_profile, then get_profile readback',
  };
}
