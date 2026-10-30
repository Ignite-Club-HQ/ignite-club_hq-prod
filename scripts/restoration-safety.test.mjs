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
  for (const entry of provenance.files) assert.equal(createHash('sha256').update(read(entry.file)).digest('hex'), entry.sha256, entry.file);
});
test('new ICP and welcome functions are preserved alongside restored senders', () => {
  for (const name of ['send-welcome-email', 'send-welcome-email-icp', 'verify-iap-receipt-icp', 'send-push-notification', 'send-fcm-notification', 'process-push-delivery-queue', 'send-email']) {
    assert.ok(existsSync(path.join(root, `supabase/functions/${name}/index.ts`)));
  }
});
test('recovered database runner cannot mutate production or repair its ledger', () => {
  const runner = read('.github/workflows/promote-to-prod.yml');
  assert.doesNotMatch(runner, /supabase (?:db push|migration repair|functions deploy)|cron\.(?:schedule|unschedule)|vault\.(?:create|update)_secret|DELETE FROM|psql|curl /i);
  assert.match(runner, /exit 1/);
});