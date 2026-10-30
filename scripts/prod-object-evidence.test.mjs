import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPublicObjectNames, buildObjectEvidenceSql } from './prod-object-evidence.mjs';

test('qualified references and unqualified lifecycle functions are included and deduplicated', () => {
  const names = collectPublicObjectNames({ a: 'ALTER TABLE public.events; SELECT public.events; CREATE FUNCTION other_guard() RETURNS trigger; EXECUTE FUNCTION another_guard();' });
  assert.ok(names.includes('events'));
  assert.ok(names.includes('other_guard'));
  assert.ok(names.includes('another_guard'));
  assert.equal(names.filter(n => n === 'events').length, 1);
});
test('invalid names cannot inject a write into the evidence query', () => {
  assert.throws(() => buildObjectEvidenceSql(["events'); DELETE FROM public.events; --"]));
  assert.throws(() => buildObjectEvidenceSql(['events', 'events']));
  assert.throws(() => buildObjectEvidenceSql(Array.from({ length: 301 }, (_, i) => `object_${i}`)));
});
test('query is read-only, bounded to named catalog objects and includes trigger functions', () => {
  const sql = buildObjectEvidenceSql(['events']);
  assert.ok(sql.includes('BEGIN TRANSACTION READ ONLY;'));
  assert.ok(sql.includes("SET LOCAL statement_timeout = '15s'"));
  assert.ok(sql.includes('SELECT t.tgfoid FROM pg_trigger'));
  assert.ok(sql.includes('ROLLBACK;'));
  assert.equal(/\b(?:INSERT INTO|UPDATE public|DELETE FROM|CREATE TABLE|ALTER TABLE|GRANT SELECT)\b/i.test(sql), false);
});
test('transition checks are opt-in and never appear in the standard catalog packet', () => {
  const sql = buildObjectEvidenceSql(['events']);
  assert.equal(sql.includes('FROM cron.job'), false);
  assert.equal(sql.includes('FROM storage.buckets'), false);
  assert.throws(() => buildObjectEvidenceSql(['events'], { includeTransitionChecks: 'true' }));
});
test('transition packet bounds bucket and exact scheduler names without exporting commands', () => {
  const sql = buildObjectEvidenceSql(['events'], { includeTransitionChecks: true });
  assert.ok(sql.includes("b.id IN ('competition-vault', 'competition-documents', 'photos', 'chat-attachments')"));
  assert.ok(sql.includes("j.jobname IN ('process-scheduled-event-reminders', 'auto-rsvp-push-cron', 'chat-photo-gallery-reminders-hourly')"));
  assert.equal(/\bj\.command\b/i.test(sql), false);
  assert.equal(/\b(?:unschedule|schedule\s*\(|alter_job|decrypted_secrets)\b/i.test(sql), false);
  assert.ok(sql.includes("has_function_privilege(r.oid, p.oid, 'EXECUTE')"));
  assert.ok(sql.includes("r.rolname IN ('anon', 'authenticated', 'service_role')"));
  assert.ok(sql.includes("d.defaclnamespace = 0"));
  assert.ok(sql.endsWith('ROLLBACK;\n'));
});