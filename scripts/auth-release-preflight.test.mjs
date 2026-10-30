import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { auditAuthRelease, auditAuthMigrationPlan } from './auth-release-preflight.mjs';

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
test('older unclassified pending migration cannot bypass review', () => {
  assert.match(auditAuthRelease({ migrations: [] }, { '20250101000000_older.sql': sql }, [])[0], /no production release classification/);
});
test('malformed policy, duplicate versions and invalid inventories fail closed', () => {
  for (const invalid of [null, {}, { migrations: [{}] }, { migrations: [policy.migrations[0], policy.migrations[0]] }, { migrations: [{ ...policy.migrations[0], prodStatus: 'skip' }] }]) {
    assert.throws(() => auditAuthRelease(invalid, { [file]: sql }, []));
  }
  assert.throws(() => auditAuthRelease(policy, { [file]: sql }, ['20261030013444', '20261030013444']));
  assert.throws(() => auditAuthRelease(policy, { 'not-a-migration.sql': sql }, []));
  assert.throws(() => auditAuthRelease(policy, { [file]: sql, '20261030013444_duplicate.sql': sql }, []));
  assert.throws(() => auditAuthRelease(policy, { [file]: 123 }, []));
});
test('complete ordered runner plan must match exact source hashes', () => {
  const second = '20261030020000_next.sql';
  const approved = { migrations: [file, second].map(file => ({ ...policy.migrations[0], file, prodStatus: 'approved' })) };
  const files = { [file]: sql, [second]: sql };
  const plan = approved.migrations.map(({ file, sha256 }) => ({ file, sha256 }));
  assert.deepEqual(auditAuthMigrationPlan(approved, files, [], plan), []);
  assert.match(auditAuthMigrationPlan(approved, files, [], [...plan].reverse())[0], /complete ordered/);
  assert.match(auditAuthMigrationPlan(approved, files, [], plan.slice(1))[0], /complete ordered/);
  assert.match(auditAuthMigrationPlan(approved, files, [], [...plan, plan[0]])[0], /complete ordered/);
  assert.match(auditAuthMigrationPlan(approved, files, [], [{ ...plan[0], sha256: '0'.repeat(64) }, plan[1]])[0], /hash does not match/);
  assert.throws(() => auditAuthMigrationPlan(approved, files, [], undefined));
});
test('an omitted blocked migration is not silently approved by a filtered plan', () => {
  const issues = auditAuthMigrationPlan(policy, { [file]: sql }, [], []);
  assert.equal(issues.length, 2);
  assert.match(issues[0], /DEV fixtures/);
  assert.match(issues[1], /complete ordered/);
});
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