/**
 * Browser-side helper for the Ignite ChatGPT MCP App secure-name control.
 * Encryption runs in the in-chat CLIENT view with official @icp-sdk/vetkeys,
 * not on a remote server; only ciphertext goes to signed canister write tools.
 *
 * This is a pure crypto helper. It does not obtain an Internet Identity,
 * fetch public keys, call canisters, accept terms, or commit a user profile.
 */
import { Principal } from '@icp-sdk/core/principal';
import { DerivedPublicKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { validateDevOwnNamePreparation } from './chatgptOwnNamePolicy.mjs';

function principalText(text) {
  const p = Principal.fromText(text);
  if (p.isAnonymous() || p.toText() !== text)
    throw Error('Canonical non-anonymous principal required');
  return p.toText();
}

/**
 * @param {object} args
 * @param {string} args.appUrl - independently discovered signed DEV app
 * @param {string} args.derivationOrigin - exact origin from open_app
 * @param {string} args.identityAccess - canister from DEV app manifest
 * @param {string} args.piiAuthority - exact original PII sink from signed identity capability
 * @param {string} args.callerPrincipal - name subject signed into the ICP connector
 * @param {string} args.verifiedPrincipal - fresh get_app_principal response
 * @param {string} args.displayName - explicitly selected display name
 * @param {number[]|Uint8Array} args.verificationKeyBytes - bytes from the declared PII canister's
 *   pii_vetkey_verification_key method, NOT arbitrary user/model-supplied bytes
 */
export function encryptOwnNameForChatGPT(args) {
  const prep = validateDevOwnNamePreparation({ ...args, canonicalPrincipal: principalText });
  const raw = args?.verificationKeyBytes;
  if (!(raw instanceof Uint8Array) && !Array.isArray(raw))
    throw Error('Authentic DEV PII verification key bytes required');
  const bytes = Uint8Array.from(raw);
  if (!bytes.length || bytes.length > 4096)
    throw Error('PII verification key is missing or malformed');
  const verificationKey = DerivedPublicKey.deserialize(bytes);
  const encrypted = IbeCiphertext.encrypt(
    verificationKey,
    IbeIdentity.fromBytes(prep.ibeIdentity),
    new TextEncoder().encode(prep.name),
    IbeSeed.random(),
  ).serialize();
  if (!encrypted.length || encrypted.length > 4096)
    throw Error('Generated private name ciphertext exceeds bounded PII size');

  // DO NOT return the plaintext display name, verification secret, or any
  // Internet Identity delegation in tool/context output. Only the bytes and
  // immutable owner-bound write parameters needed by the signed ICP connector.
  return Object.freeze({
    pii_id: prep.subject,
    field_id: prep.fieldId,
    domain_owner: prep.subject,
    pii_canister: args.piiAuthority,
    identity_canister: args.identityAccess,
    encrypted_bytes: Array.from(encrypted),
    profile_reference: prep.reference,
  });
}
