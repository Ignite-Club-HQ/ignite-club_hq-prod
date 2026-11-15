/**
 * Starts the two independent ICP vetKeys prerequisites before awaiting either.
 * A fresh shared-audience encrypted key can be requested while the PUBLIC
 * verification key is fetched. The caller verifies/decrypts locally only after
 * both return; a refusal rejects and no plaintext or signing key is sent.
 *
 * No transport/proxy/actor is created here: the caller supplies the existing
 * first-party canister read functions.
 */
export async function readSharedVetKeyMaterialsConcurrently<PublicKey, EncryptedKey>(
  readPublicKey: () => Promise<PublicKey>,
  readEncryptedKey: () => Promise<EncryptedKey>,
): Promise<readonly [PublicKey, EncryptedKey]> {
  return Promise.all([readPublicKey(), readEncryptedKey()]);
}
