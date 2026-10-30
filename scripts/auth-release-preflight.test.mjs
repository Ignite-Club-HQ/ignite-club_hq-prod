import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { auditAuthRelease } from './auth-release-preflight.mjs';

const sql = 'select 1;';
const file = '20261030013444_fixture.sql';
const policy = { migrations: [{ file, sha256: createHash('sha256').update(sql).digest('hex'), prodStatus: 'blocked', reason: 'DEV fixtures' }] };
test('pending DEV fixture blocks production release', () => assert.deepEqual(auditAuthRelease(policy, { [file]: sql }, []), [`${file}: DEV fixtures`]));
test('applied unchanged migration does not need replay', () => assert.deepEqual(auditAuthRelease(policy, { [file]: sql }, ['20261030013444']), []));
test('editing or deleting an applied migration is refused', () => {
  assert.match(auditAuthRelease(policy, { [file]: 'select 2;' }, ['20261030013444'])[0], /removed or edited/);
  assert.match(auditAuthRelease(policy, {}, ['20261030013444'])[0], /removed or edited/);
});
test('unknown pending migration fails closed', () => assert.match(auditAuthRelease({ migrations: [] }, { [file]: sql }, [])[0], /no production release classification/));
test('missing or malformed target ledger is refused', () => {
  assert.throws(() => auditAuthRelease(policy, { [file]: sql }, undefined));
  assert.throws(() => auditAuthRelease(policy, { [file]: sql }, [123]));
});
test('real applied DEV migration files retain their protected fingerprints', () => {
  const real = JSON.parse(readFileSync(new URL('./auth-release-policy.json', import.meta.url), 'utf8'));
  const files = Object.fromEntries(real.migrations.map(m => [m.file, readFileSync(new URL(`../supabase/migrations/${m.file}`, import.meta.url), 'utf8')]));
  assert.equal(real.migrations.length, 6);
  assert.deepEqual(auditAuthRelease(real, files, real.migrations.map(m => m.file.split('_')[0])), []);
  assert.equal(auditAuthRelease(real, files, []).length, 6);
});