import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
test('restored notification source matches the immutable backup exactly', () => {
  const provenance = JSON.parse(read('docs/main-backup-notification-provenance.json'));
  assert.equal(provenance.commit, '96642d0750e03d933b68957d61999de3ae983b9c');
  assert.equal(provenance.files.length, 77);
  for (const entry of provenance.files) {
    const archive = ['supabase/functions/auto-rsvp-push-cron/index.ts', 'supabase/functions/chat-photo-gallery-reminders/index.ts'].includes(entry.file)
      ? `docs/recovery/main-backup/${entry.file}` : entry.file;
    assert.equal(createHash('sha256').update(read(archive)).digest('hex'), entry.sha256, archive);
  }
});
test('new ICP and welcome functions are preserved alongside restored senders', () => {
  for (const name of ['send-welcome-email', 'send-welcome-email-icp', 'verify-iap-receipt-icp', 'send-push-notification', 'send-fcm-notification', 'process-push-delivery-queue', 'send-email']) {
    assert.ok(existsSync(path.join(root, `supabase/functions/${name}/index.ts`)));
  }
});
test('all original migration source blobs survive outside the executable migration folder', () => {
  const provenance = JSON.parse(read('docs/recovery/main-backup/provenance.json'));
  assert.equal(provenance.executable, false);
  assert.equal(provenance.migrations.length, 1135);
  for (const entry of provenance.migrations) {
    assert.ok(entry.archivePath.startsWith('docs/recovery/main-backup/migration-source/'));
    const bytes = readFileSync(path.join(root, entry.archivePath));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex'), entry.gitBlob);
  }
});
test('native marketing version is recovered from original and last verified PROD source', () => {
  const settings = JSON.parse(read('scripts/native-release-settings.json'));
  const original = JSON.parse(read('docs/recovery/main-backup/package.json'));
  assert.equal(settings.marketingVersion, '1.2.63');
  assert.equal(settings.marketingVersion, original.version);
  assert.equal(settings.appId, 'app.lovable.igniteteamhub');
});
test('structural release runner never performs legacy operational repairs or data copies', () => {
  const runner = read('.github/workflows/promote-to-prod.yml');
  const implementation = read('scripts/supabase-structural-release.mjs');
  assert.doesNotMatch(runner + implementation, /migration repair|cron\.(?:schedule|unschedule|alter_job)|vault\.(?:create|update)_secret|db dump|secrets set|functions delete/i);
  assert.match(implementation, /auditAuthMigrationPlan/);
  assert.match(implementation, /default_transaction_read_only=on/);
  assert.match(runner, /branches: \[prod\]/);
});