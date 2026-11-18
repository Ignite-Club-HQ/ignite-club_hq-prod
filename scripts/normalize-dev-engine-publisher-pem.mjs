/**
 * Restore the pre-existing DEV frontend publishing PEM without replacing keys.
 * Accepts legacy workflow encodings: ordinary PEM, flattened whitespace,
 * literal backslash-n, Unicode dash substitutions and whole-PEM base64.
 * No logging of private material. Only a valid secp256k1 PRIVATE KEY passes.
 *
 * This is deliberately specific to the DEV engine frontend publisher;
 * backend governor restoration keeps its existing stricter workflow.
 */
import { createPrivateKey } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function normalizeExistingDevPublisherPem(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 65_536)
    throw new Error('Existing DEV publisher key missing or invalid length');

  const clean = (s) => s
    .replace(/\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u00a0/g, ' ')
    .trim().replace(/^['"]|['"]$/g, '').trim();

  let raw = clean(input);
  if (!/BEGIN/i.test(raw)) {
    const encoded = raw.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      throw new Error('Existing DEV publisher key contains no PEM block');
    raw = clean(Buffer.from(encoded, 'base64').toString('utf8'));
  }

  const match = /-{2,}\s*BEGIN\s+(EC PRIVATE KEY|PRIVATE KEY|ENCRYPTED PRIVATE KEY)\s*-{2,}([\s\S]*?)-{2,}\s*END\s+\1\s*-{2,}/i.exec(raw);
  if (!match)
    throw new Error('Existing DEV publisher key has no complete PRIVATE KEY block');

  const label = match[1].toUpperCase();
  if (label === 'ENCRYPTED PRIVATE KEY')
    throw new Error('Password-encrypted DEV publisher key cannot be imported automatically');

  const base64 = match[2].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 32_768)
    throw new Error('Existing DEV publisher key body has invalid encoding');

  const rows = base64.match(/.{1,64}/g) ?? [];
  const normalized = `-----BEGIN ${label}-----\n${rows.join('\n')}\n-----END ${label}-----\n`;
  try {
    const key = createPrivateKey(normalized);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'secp256k1')
      throw new Error('Unsupported signing algorithm');
  } catch {
    throw new Error('Existing DEV publisher key is not a valid secp256k1 private key');
  }
  return normalized;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(normalizeExistingDevPublisherPem(process.env.PEM_IN));
  } catch (error) {
    // Do not echo the key, raw input, decoder output or crypto exceptions.
    console.error('::error::' + error.message);
    process.exitCode = 1;
  }
}
