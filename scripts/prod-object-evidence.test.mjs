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