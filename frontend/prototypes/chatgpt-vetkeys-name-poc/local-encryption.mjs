/**
 * Synthetic-only browser proof for the original Ignite profile-name IBE path.
 * No real identity, private key, authenticator or canister calls exist here.
 * Do not use this fixture as an authority for live onboarding.
 */
import { Principal } from '@icp-sdk/core/principal';
import { prepareEncryptedChatgptProfileName } from '../../scripts/prepare-icp-chatgpt-private-name.mjs';

const PUBLIC_VERIFICATION_KEY = Uint8Array.from([
  177,78,48,240,39,234,226,250,163,45,107,185,179,87,249,4,
  113,97,47,2,140,204,166,139,115,233,231,155,126,96,58,13,
  177,58,235,166,72,77,108,230,164,14,171,99,8,189,77,249,
  5,252,123,102,83,62,240,95,130,46,204,29,55,217,215,12,
  228,80,86,157,252,41,64,98,116,136,172,236,41,43,138,10,
  130,223,174,28,225,98,96,53,85,12,213,228,186,91,161,192
]);
const SYNTHETIC_PRINCIPAL = Principal.selfAuthenticating(new Uint8Array(32).fill(27)).toText();
const ORIGINAL_DEV_PII_CANISTER = 'iui5p-aaaaa-aaaal-qxllq-cai';

/**
 * Encrypt with the exact existing Ignite SDK and subject/field identity.
 * Return only a boolean and ciphertext size; never return the name, key,
 * ciphertext or Candid args to a model, host, browser storage, or network.
 * This is ONLY a local demonstration and cannot register an account.
 */
export function encryptInventedNameLocally(inventedName) {
  let prepared;
  try {
    prepared = prepareEncryptedChatgptProfileName({
      displayName: inventedName,
      callerPrincipal: SYNTHETIC_PRINCIPAL,
      piiAuthority: ORIGINAL_DEV_PII_CANISTER,
      verificationKey: PUBLIC_VERIFICATION_KEY
    });
    const size = prepared.ciphertext.length;
    if (prepared.registrationArgs.includes(inventedName.trim()) ||
        prepared.profileArgs.includes(inventedName.trim())) {
      throw new Error('Unsafe private-name output');
    }
    return Object.freeze({ encryptedLocally: true, ciphertextBytes: size });
  } finally {
    // Best-effort cleanup of the mutable ciphertext buffer; JavaScript cannot
    // guarantee erasure of prior copies or strings held by the runtime.
    if (prepared?.ciphertext instanceof Uint8Array) prepared.ciphertext.fill(0);
  }
}
