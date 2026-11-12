/** Reconstructs local disposable state only: no management calls, canister
 * snapshots, controller proofs, key recovery or resume authority. */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readPreparationBackup, preparationBindingHash } from './engine-operational-preparation.mjs';

export async function rehearseLocalGroupRestore(path, binding, key, expected, decode) {
  binding = structuredClone(binding); expected = structuredClone(expected);
  const started = performance.now();
  if (!Array.isArray(expected) || expected.length !== binding.services.length ||
      new Set(expected.map(s => s.service)).size !== expected.length ||
      binding.services.some(s => !expected.some(e => e.service === s.service))) throw Error('Complete decoded group before-image required');
  const payload = await readPreparationBackup(path, binding, key);
  const decoded = [];
  // Decode and validate the whole inventory BEFORE constructing the destination.
  for (const entry of payload.entries) {
    const content = await decode(entry.service, Buffer.from(entry.bytes, 'base64'));
    if (content === undefined) throw Error('Missing decoded service');
    decoded.push({ service: entry.service, content });
  }
  const order = rows => [...rows].sort((a, b) => a.service.localeCompare(b.service));
  const digest = rows => createHash('sha256').update(JSON.stringify(order(rows))).digest('hex');
  if (digest(decoded) !== digest(expected)) throw Error('Decoded group differs from before-image');
  // Fresh disposable destination; read back every service, never sampled rows.
  const restored = new Map(decoded.map(s => [s.service, structuredClone(s.content)]));
  const readback = [...restored].map(([service, content]) => ({ service, content }));
  if (digest(readback) !== digest(expected)) throw Error('Rebuilt group readback differs');
  return { preparationOnly: true, activationAuthorized: false, independentlyVerified: false,
    liveGroupRestored: false, encryptedMediaRecoverable: false, localGroupRebuilt: true,
    bindingHash: preparationBindingHash(binding), services: restored.size,
    semanticHash: digest(readback), elapsedMs: Math.max(0, performance.now() - started) };
}