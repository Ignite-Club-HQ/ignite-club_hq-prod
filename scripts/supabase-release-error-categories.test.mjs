import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFailureCategory } from './supabase-structural-release.mjs';

for (const [stderr, expected] of [
  ['could not translate host name "private-host"', 'database address could not be resolved'],
  ['Network is unreachable', 'database network unreachable'],
  ['connection refused', 'database connection refused'],
  ['connection timed out', 'database connection timed out'],
  ['SSL certificate verify failed', 'database secure connection failed'],
  ['permission denied for table private_table', 'database permission refused'],
  ['canceling statement due to lock timeout', 'database lock timeout'],
  ['canceling statement due to statement timeout', 'database statement timeout'],
  ['function private_function does not exist', 'required database object missing'],
  ['policy private_policy already exists', 'database object already exists'],
  ['syntax error at private_sql', 'database SQL syntax rejected'],
  ['unknown failure with password=private-value', 'unclassified database command failure (raw details withheld)'],
]) {
  test(expected, () => assert.equal(databaseFailureCategory({ stderr }), expected));
}
test('missing client is distinguished without echoing spawn arguments', () => {
  assert.equal(databaseFailureCategory({ error: { code: 'ENOENT' } }), 'database client unavailable');
});