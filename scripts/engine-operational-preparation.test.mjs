import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { writePreparationBackup, readPreparationBackup, drillPreparationRestore,
  preparationBindingHash, assessPreparationFunding, runPreparationMonitor } from './engine-operational-preparation.mjs';

const binding = { deploymentId: 'test', host: 'https://test.example', networkKind: 'cloud_engine',
  registryRevision: '9007199254740993', services: [
    { service: 'authority', canisterId: 'authority-id', subnetId: 's1', moduleHash: 'a'.repeat(64) },
    { service: 'store', canisterId: 'store-id', subnetId: 's1', moduleHash: 'b'.repeat(64) } ] };
const content = { authority: { roles: ['manager'], zero: 0, unset: null }, store: { history: [1, 2], ciphertext: 'fixture-ciphertext' } };
const exportBytes = async s => Buffer.from(JSON.stringify(content[s.service]));
const decode = async (_s, bytes) => JSON.parse(bytes);
const semanticHash = createHash('sha256').update(JSON.stringify(binding.services.map(s => ({ service: s.service, content: content[s.service] })))).digest('hex');
async function withBackup(run) {
  const dir = await mkdtemp(join(tmpdir(), 'engine-backup-')); const path = join(dir, 'backup.json'), key = randomBytes(32);
  try { await writePreparationBackup(path, binding, 1000, exportBytes, key); await run(path, key); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
test('encrypted backup roundtrips full decoded local inventory without claiming media recovery or release', () => withBackup(async (path, key) => {
  const disk = await readFile(path, 'utf8'); assert.equal(disk.includes('fixture-ciphertext'), false); assert.equal(disk.includes('manager'), false);
  const report = await drillPreparationRestore(path, binding, key, decode, semanticHash);
  assert.equal(report.services, 2); assert.equal(report.localRestorePassed, true);
  assert.equal(report.activationAuthorized, false); assert.equal(report.encryptedMediaRecoverable, false);
  const payload = await readPreparationBackup(path, binding, key);
  assert.deepEqual(JSON.parse(Buffer.from(payload.entries[0].bytes, 'base64')), content.authority);
}));
test('wrong key and modified ciphertext refuse before decoding', () => withBackup(async (path, key) => {
  await assert.rejects(readPreparationBackup(path, binding, randomBytes(32)));
  const e = JSON.parse(await readFile(path, 'utf8')); e.ciphertext = (e.ciphertext[0] === 'A' ? 'B' : 'A') + e.ciphertext.slice(1);
  await writeFile(path, JSON.stringify(e)); let calls = 0;
  await assert.rejects(drillPreparationRestore(path, binding, key, async () => { calls++; }, semanticHash)); assert.equal(calls, 0);
}));
for (const field of ['registryRevision', 'host', 'networkKind', 'moduleHash', 'inventory']) test(`backup refuses changed ${field}`, () => withBackup(async (path, key) => {
  const changed = structuredClone(binding);
  if (field === 'registryRevision') changed.registryRevision = '9007199254740994';
  if (field === 'host') changed.host = 'https://other.example';
  if (field === 'networkKind') changed.networkKind = 'public_mainnet';
  if (field === 'moduleHash') changed.services[0].moduleHash = 'c'.repeat(64);
  if (field === 'inventory') changed.services.pop();
  await assert.rejects(readPreparationBackup(path, changed, key), /destination/);
}));
test('raw byte roundtrip does not pass differing decoded semantics', () => withBackup(async (path, key) => {
  await assert.rejects(drillPreparationRestore(path, binding, key, async () => ({ discarded: true }), semanticHash), /Decoded/);
}));
test('existing backups are never overwritten', () => withBackup(async (path, key) => {
  const before = await readFile(path); await assert.rejects(writePreparationBackup(path, binding, 2000, exportBytes, key), /EEXIST/);
  assert.deepEqual(await readFile(path), before);
}));
test('missing export refuses without producing partial backup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-backup-')), path = join(dir, 'missing.json');
  try { await assert.rejects(writePreparationBackup(path, binding, 1000, async () => undefined, randomBytes(32)), /Missing/);
    await assert.rejects(readFile(path), /ENOENT/); } finally { await rm(dir, { recursive: true, force: true }); }
});
const now = 10000;
const policy = { maxReadingAgeMs: 500, warningRunwayMs: 3000, urgentRunwayMs: 1000,
  maxBackupAgeMs: 2000, maxRestoreDrillAgeMs: 1000, minimumCycles: 100n };
const reading = b => ({ bindingHash: preparationBindingHash(b), observedAtMs: now,
  paidThroughMs: now + 4000, automaticPayment: 'healthy', serviceRunning: true,
  cycles: b.services.map(s => ({ canisterId: s.canisterId, balance: 100n })),
  backup: { bindingHash: preparationBindingHash(b), createdAtMs: 9500, restoreAtMs: 9900, localRestorePassed: true } });
test('zero-cycle engines use rental runway, never mainnet top-up policy', () => {
  const r = reading(binding); r.cycles.forEach(s => s.balance = 0n);
  assert.deepEqual(assessPreparationFunding(binding, now, policy, r).reasons, []);
});
for (const [runway, reason] of [[3000, 'warning-rental-runway'], [1000, 'urgent-rental-runway'], [0, 'urgent-rental-runway']]) test(`rental alerts include exact ${runway} boundary`, () => {
  assert.ok(assessPreparationFunding(binding, now, policy, { ...reading(binding), paidThroughMs: now + runway }).reasons.includes(reason));
});
test('mainnet threshold and missing inventory remain distinct', () => {
  const b = { ...binding, networkKind: 'public_mainnet' }, r = reading(b);
  assert.deepEqual(assessPreparationFunding(b, now, policy, r).reasons, []);
  r.cycles[0].balance = 99n; assert.ok(assessPreparationFunding(b, now, policy, r).reasons.includes('low-mainnet-fuel'));
  r.cycles.pop(); const reasons = assessPreparationFunding(b, now, policy, r).reasons;
  assert.ok(reasons.includes('fuel-reading-unavailable')); assert.equal(reasons.includes('low-mainnet-fuel'), false);
});
test('stale and foreign readings never certify healthy funding', () => {
  for (const r of [{ ...reading(binding), observedAtMs: now - 501 }, { ...reading(binding), bindingHash: 'foreign' }, { ...reading(binding), observedAtMs: now + 1 }])
    assert.ok(assessPreparationFunding(binding, now, policy, r).reasons.includes('funding-reading-unavailable'));
});
test('failed payment and stale/unreadable restore issue local alerts', async () => {
  const alerts = []; const r = { ...reading(binding), automaticPayment: 'failed', backup: undefined };
  const report = await runPreparationMonitor(binding, now, policy, async () => r, async a => alerts.push(a));
  assert.deepEqual(alerts[0].reasons, ['payment-needs-attention', 'backup-missing-or-stale', 'local-restore-not-demonstrated']);
  assert.equal(report.activationAuthorized, false); assert.equal(report.independentlyVerified, false);
});
test('reader failure produces bounded content-free local warning, not raw provider text', async () => {
  const alerts = []; await runPreparationMonitor(binding, now, policy, async () => { throw Error('secret-provider-text'); }, async a => alerts.push(a));
  assert.equal(alerts.length, 1); assert.equal(JSON.stringify(alerts).includes('secret-provider-text'), false);
  assert.ok(alerts[0].reasons.includes('funding-reading-unavailable'));
});