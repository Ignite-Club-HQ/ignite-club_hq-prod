/** Offline, credential-free preparation. No payment, scheduler, management or
 * routing adapter is created here. Encrypted files are local drills, not live
 * snapshots or independent evidence that encrypted club media is recoverable. */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_SERVICES = 64;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function validateBinding(binding) {
  if (!binding || !['public_mainnet', 'cloud_engine'].includes(binding.networkKind) ||
      typeof binding.deploymentId !== 'string' || !binding.deploymentId.trim() ||
      !/^[1-9][0-9]*$/.test(binding.registryRevision ?? '') || !Array.isArray(binding.services) ||
      binding.services.length < 1 || binding.services.length > MAX_SERVICES) throw new Error('Complete deployment binding required');
  const url = new URL(binding.host);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('HTTPS origin required');
  const names = new Set(), ids = new Set();
  for (const s of binding.services) {
    if (!s || !['service', 'canisterId', 'subnetId'].every(k => typeof s[k] === 'string' && s[k].trim()) ||
        !/^[a-f0-9]{64}$/.test(s.moduleHash ?? '') || names.has(s.service) || ids.has(s.canisterId)) throw new Error('Exact unique service inventory required');
    names.add(s.service); ids.add(s.canisterId);
  }
  return { deploymentId: binding.deploymentId, host: url.origin, networkKind: binding.networkKind,
    registryRevision: binding.registryRevision,
    services: binding.services.map(s => ({ service: s.service, canisterId: s.canisterId,
      subnetId: s.subnetId, moduleHash: s.moduleHash })).sort((a, b) => a.service.localeCompare(b.service)) };
}
const bindingHash = binding => hash(JSON.stringify(validateBinding(binding)));
const validTime = t => Number.isSafeInteger(t) && t >= 0;
function validatePayload(payload, binding) {
  if (payload?.format !== 'ignite-offline-backup' || payload.version !== 1 || payload.preparationOnly !== true ||
      !validTime(payload.createdAtMs) || payload.bindingHash !== bindingHash(binding) ||
      !Array.isArray(payload.entries) || payload.entries.length !== binding.services.length) throw new Error('Backup binding or inventory changed');
  const services = validateBinding(binding).services;
  for (let i = 0; i < services.length; i++) {
    const entry = payload.entries[i];
    if (entry?.service !== services[i].service || typeof entry.bytes !== 'string' ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.bytes)) throw new Error('Invalid backup entry');
    const bytes = Buffer.from(entry.bytes, 'base64');
    if (bytes.length !== entry.size || hash(bytes) !== entry.sha256) throw new Error('Backup content mismatch');
  }
  return payload;
}
function keyBytes(key) {
  if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error('External 32-byte backup key required');
  return key;
}
/** Bounded fixture/local exports only. Never point this at live snapshot APIs. */
export async function writePreparationBackup(path, binding, createdAtMs, readLocalExport, key) {
  binding = validateBinding(binding); keyBytes(key);
  if (!validTime(createdAtMs)) throw new Error('Backup time required');
  const entries = []; let total = 0;
  for (const service of binding.services) {
    const bytes = await readLocalExport(structuredClone(service));
    if (!(bytes instanceof Uint8Array)) throw new Error('Missing local export');
    total += bytes.byteLength;
    if (total > MAX_BYTES) throw new Error('Local backup size limit exceeded');
    entries.push({ service: service.service, size: bytes.length, sha256: hash(bytes), bytes: Buffer.from(bytes).toString('base64') });
  }
  const payload = { format: 'ignite-offline-backup', version: 1, preparationOnly: true,
    createdAtMs, bindingHash: bindingHash(binding), entries };
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const aad = Buffer.from(payload.bindingHash); cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  const envelope = { version: 1, bindingHash: payload.bindingHash, iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  // Exclusive creation: a failed write remains held; never replace a previous backup.
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(envelope)); await file.sync(); } finally { await file.close(); }
  return { preparationOnly: true, activationAuthorized: false, createdAtMs,
    bindingHash: payload.bindingHash, services: entries.length, plaintextBytes: total };
}
export async function readPreparationBackup(path, binding, key) {
  keyBytes(key); const file = await open(path, 'r');
  let data;
  try {
    if ((await file.stat()).size > MAX_BYTES * 2) throw new Error('Backup size limit exceeded');
    data = await file.readFile('utf8');
  } finally { await file.close(); }
  const envelope = JSON.parse(data);
  const expected = bindingHash(binding);
  if (envelope.version !== 1 || envelope.bindingHash !== expected) throw new Error('Backup destination mismatch');
  const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted backup');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(expected)); decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
  return validatePayload(JSON.parse(plain.toString('utf8')), binding);
}
/** Decodes the entire local inventory before comparison; no partial restore and
 * no authority resume. Caller decoders are not independent ledger evidence. */
export async function drillPreparationRestore(path, binding, key, decodeLocalExport, expectedSemanticHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedSemanticHash)) throw new Error('Expected decoded-content hash required');
  const payload = await readPreparationBackup(path, binding, key);
  const decoded = [];
  for (const entry of payload.entries) decoded.push({ service: entry.service,
    content: await decodeLocalExport(entry.service, Buffer.from(entry.bytes, 'base64')) });
  const semanticHash = hash(JSON.stringify(decoded));
  if (semanticHash !== expectedSemanticHash) throw new Error('Decoded local content differs');
  return { preparationOnly: true, activationAuthorized: false, independentlyVerified: false,
    backupAtMs: payload.createdAtMs, bindingHash: payload.bindingHash, services: decoded.length,
    semanticHash, localRestorePassed: true, encryptedMediaRecoverable: false };
}

/** Build content-free alerts from supplied readings. Engine 0 cycles is normal:
 * engine rent is judged from paid-through, mainnet fuel from cycles. */
export function assessPreparationFunding(binding, now, policy, reading) {
  const expected = bindingHash(binding); const reasons = [];
  if (!validTime(now) || !policy || ![policy.maxReadingAgeMs, policy.warningRunwayMs, policy.urgentRunwayMs,
      policy.maxBackupAgeMs, policy.maxRestoreDrillAgeMs].every(v => Number.isSafeInteger(v) && v > 0) ||
      policy.warningRunwayMs <= policy.urgentRunwayMs) throw new Error('Explicit monitoring policy required');
  const fresh = (time, age) => validTime(time) && time <= now && now - time <= age;
  const trusted = reading?.bindingHash === expected && fresh(reading.observedAtMs, policy.maxReadingAgeMs);
  if (!trusted) reasons.push('funding-reading-unavailable');
  else {
    if (binding.networkKind === 'cloud_engine') {
      if (!validTime(reading.paidThroughMs)) reasons.push('rental-reading-unavailable');
      else if (reading.paidThroughMs - now <= policy.urgentRunwayMs) reasons.push('urgent-rental-runway');
      else if (reading.paidThroughMs - now <= policy.warningRunwayMs) reasons.push('warning-rental-runway');
      if (reading.automaticPayment !== 'healthy') reasons.push('payment-needs-attention');
    } else {
      if (typeof policy.minimumCycles !== 'bigint' || policy.minimumCycles <= 0n) throw new Error('Explicit mainnet fuel threshold required');
      const rows = reading.cycles;
      if (!Array.isArray(rows) || rows.length !== binding.services.length ||
          new Set(rows.map(r => r.canisterId)).size !== rows.length ||
          binding.services.some(s => !rows.some(r => r.canisterId === s.canisterId && typeof r.balance === 'bigint' && r.balance >= 0n))) reasons.push('fuel-reading-unavailable');
      else if (rows.some(r => r.balance < policy.minimumCycles)) reasons.push('low-mainnet-fuel');
    }
    if (reading.serviceRunning !== true) reasons.push('service-not-running');
  }
  const backup = reading?.backup;
  if (backup?.bindingHash !== expected || !fresh(backup.createdAtMs, policy.maxBackupAgeMs)) reasons.push('backup-missing-or-stale');
  if (backup?.localRestorePassed !== true || !fresh(backup.restoreAtMs, policy.maxRestoreDrillAgeMs) ||
      backup.restoreAtMs < backup.createdAtMs) reasons.push('local-restore-not-demonstrated');
  return { preparationOnly: true, activationAuthorized: false, independentlyVerified: false,
    bindingHash: expected, reasons, needsAttention: reasons.length > 0 };
}
/** Single manually invoked pass. No recurring scheduling or notification sends. */
export async function runPreparationMonitor(binding, now, policy, read, recordAlert) {
  binding = validateBinding(binding);
  let reading; try { reading = await read(structuredClone(binding)); } catch { reading = undefined; }
  const report = assessPreparationFunding(binding, now, policy, reading);
  if (report.needsAttention) await recordAlert({ deploymentId: binding.deploymentId,
    bindingHash: report.bindingHash, observedAtMs: now, reasons: [...report.reasons], preparationOnly: true });
  return report;
}
export { bindingHash as preparationBindingHash };