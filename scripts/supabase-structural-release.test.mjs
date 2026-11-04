import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { planRelease, selectFunctions, hash } from './supabase-structural-release.mjs';

const file = '20261104030000_example.sql';
const sql = 'CREATE TABLE public.example(id uuid); GRANT SELECT ON public.example TO authenticated; ALTER TABLE public.example ENABLE ROW LEVEL SECURITY;';
const policy = { migrations: [{ file, sha256: hash(sql), prodStatus: 'approved', reason: 'reviewed structure' }] };
test('only reviewed complete structural migrations are planned', () => {
  assert.deepEqual(planRelease(policy, { [file]: sql }, []).plan, [{ file, sha256: hash(sql) }]);
  assert.deepEqual(planRelease(policy, { [file]: sql }, []).issues, []);
});
test('unclassified and edited SQL cannot be deployed', () => {
  assert.ok(planRelease({ migrations: [] }, { [file]: sql }, []).issues.length > 0);
  assert.ok(planRelease(policy, { [file]: sql + ' SELECT 1;' }, []).issues.length > 0);
});
test('unknown target history is held rather than repaired', () => {
  assert.ok(planRelease(policy, { [file]: sql }, [{ version: '20200101000000' }]).issues.some(issue => issue.includes('no repair')));
});
test('shared function changes deploy all functions, deletion never happens', () => {
  assert.deepEqual(selectFunctions(['supabase/functions/_shared/auth.ts'], ['b', 'a']), ['a', 'b']);
  assert.throws(() => selectFunctions(['supabase/functions/deleted/index.ts'], ['a']), /no deletion/);
});
function inspect(source) {
  const result = spawnSync('python3', ['scripts/structural-sql-check.py'], { input: JSON.stringify({ migration: source }), encoding: 'utf8' });
  assert.ok([0, 1].includes(result.status));
  return JSON.parse(result.stdout);
}
test('schema and RLS definitions are structural', () => assert.deepEqual(inspect(sql), []));
for (const statement of ['INSERT INTO public.clubs VALUES (1)', 'UPDATE public.clubs SET name=\'x\'', 'DELETE FROM public.clubs', 'TRUNCATE public.clubs', 'CREATE TABLE public.copy AS SELECT * FROM public.clubs', 'DO $$ BEGIN DELETE FROM public.clubs; END $$', 'SELECT cron.schedule(\'x\', \'* * * * *\', \'select 1\')', 'ALTER TABLE public.clubs DROP COLUMN name']) {
  test(`reject release-time data/operational SQL: ${statement.split(' ')[0]}`, () => assert.ok(inspect(statement).length > 0));
}
test('runtime function definition is allowed but invoking it during release is not', () => {
  const definition = 'CREATE FUNCTION public.test() RETURNS void LANGUAGE sql AS $$ DELETE FROM public.clubs $$';
  assert.deepEqual(inspect(definition), []);
  assert.ok(inspect(definition + '; SELECT public.test()').length > 0);
});