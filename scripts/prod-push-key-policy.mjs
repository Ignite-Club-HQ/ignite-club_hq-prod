import { scryptSync, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const PUSH_KEY_CONFIRMATION = 'CREATE PROD PUSH KEY';
export function assertPushKeyContext(env) {
  if (env.GITHUB_REPOSITORY !== 'Ignite-Club-HQ/ignite-club_hq-prod' ||
      env.GITHUB_REF !== 'refs/heads/prod' || env.IGNITE_ICP_ENV !== 'prod') throw new Error('Use the live repository prod branch');
  if (env.PROD_ICP_PUSH_ENABLED === 'true') throw new Error('ICP delivery must remain disabled');
  if (env.ACTION_CONFIRM !== PUSH_KEY_CONFIRMATION) throw new Error(`Type ${PUSH_KEY_CONFIRMATION}`);
  if ((env.PASSPHRASE ?? '').length < 32) throw new Error('Store a dedicated passphrase of at least 32 characters');
}
export function assertNoStoredPushKey(env) {
  if (env.EXISTING_SEED || env.EXISTING_ENC || env.EXISTING_PRINCIPAL) throw new Error('A PROD delivery key is already recorded; minting a replacement is refused');
}
export function sealPushSeed(seed, passphrase) {
  if (!/^[a-f0-9]{64}$/i.test(seed)) throw new Error('Invalid delivery seed');
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv);
  const ciphertext = Buffer.concat([cipher.update(seed, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('IPK1'), salt, iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
export function openPushSeed(blob, passphrase) {
  try {
    const bytes = Buffer.from(blob, 'base64');
    if (bytes.length !== 112 || bytes.subarray(0, 4).toString() !== 'IPK1') throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, bytes.subarray(4, 20), 32), bytes.subarray(20, 32));
    decipher.setAuthTag(bytes.subarray(32, 48));
    const seed = Buffer.concat([decipher.update(bytes.subarray(48)), decipher.final()]).toString('utf8');
    if (!/^[a-f0-9]{64}$/i.test(seed)) throw new Error();
    return seed;
  } catch { throw new Error('Encrypted PROD delivery key could not be verified; stop without replacing it'); }
}

export function resolveProdPushPrincipal(env, identityType) {
  let seed;
  if (env.PROD_ICP_PUSH_WORKER_SEED && env.PROD_ICP_PUSH_WORKER_SEED_ENC) throw new Error('Two PROD delivery keys are configured; stop for review');
  if (env.PROD_ICP_PUSH_WORKER_SEED_ENC) {
    if (!env.PROD_ICP_PUSH_WORKER_PASSPHRASE || !env.PROD_ICP_PUSH_WORKER_PRINCIPAL) throw new Error('Encrypted key needs its passphrase and recorded PROD principal');
    seed = openPushSeed(env.PROD_ICP_PUSH_WORKER_SEED_ENC, env.PROD_ICP_PUSH_WORKER_PASSPHRASE);
  } else seed = env.PROD_ICP_PUSH_WORKER_SEED;
  if (!/^[a-f0-9]{64}$/i.test(seed ?? '')) throw new Error('PROD delivery key is missing or invalid');
  const principal = identityType.fromSecretKey(new Uint8Array(Buffer.from(seed, 'hex'))).getPrincipal().toText();
  if (env.PROD_ICP_PUSH_WORKER_PRINCIPAL && principal !== env.PROD_ICP_PUSH_WORKER_PRINCIPAL) throw new Error('PROD delivery principal mismatch');
  if ([env.DEV_PUSH_WORKER_PRINCIPAL, env.PROD_GOVERNOR_PRINCIPAL].filter(Boolean).includes(principal)) throw new Error('PROD delivery key must be separate from DEV and governor');
  return principal;
}