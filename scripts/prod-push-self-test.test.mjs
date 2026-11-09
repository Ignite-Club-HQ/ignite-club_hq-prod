import test from 'node:test';
import assert from 'node:assert/strict';
import { PAUL_PUSH_TEST_RECIPIENT as paul, validateSelfTest, runNativeSelfTest } from './prod-push-self-test.mjs';
const env = { GITHUB_REPOSITORY: 'Ignite-Club-HQ/ignite-club_hq-prod', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/prod', IGNITE_ICP_ENV: 'prod', ICP_PUSH_NATIVE_SELF_TEST: 'true', GITHUB_RUN_ID: '123' };
const recipients = new Set([paul]);
const row = (token, platform = 'android', stamp = 1n) => ({ user: paul, token, platform, updated_at_ms: stamp });
for (const [name, value] of [['GITHUB_EVENT_NAME', 'schedule'], ['GITHUB_REF', 'refs/heads/main'], ['IGNITE_ICP_ENV', 'dev'], ['ICP_PUSH_NATIVE_SELF_TEST', 'false'], ['GITHUB_REPOSITORY', 'other/repo']]) {
  test(`refuses self-test with ${name}=${value}`, () => assert.throws(() => validateSelfTest({ ...env, [name]: value }, recipients)));
}
test('only Paul is eligible even if the rollout list is widened', () => {
  assert.equal(validateSelfTest(env, recipients), paul);
  assert.throws(() => validateSelfTest(env, new Set(['other'])));
  assert.throws(() => validateSelfTest(env, new Set([paul, 'other'])));
});
async function probe(rows, send) {
  return runNativeSelfTest({ env, recipients, directory: { list_device_tokens: async users => { assert.deepEqual(users, [paul]); return { Ok: rows }; } }, send });
}
test('sends once to only the newest native device, never browser or another account', async () => {
  const calls = [];
  const result = await probe([row('old'), row('new', 'ios', 3n), row('browser', 'web', 99n)], async (token, notification) => { calls.push(token); assert.equal(notification.user, paul); return null; });
  assert.deepEqual(calls, ['new']); assert.deepEqual(result, { status: 'accepted_by_firebase', accepted: 1 });
});
test('missing native registration sends nothing', async () => {
  let sent = 0; assert.equal((await probe([row('web', 'web')], async () => { sent++; })).status, 'no_device'); assert.equal(sent, 0);
});
test('unexpected account rows fail closed', async () => {
  let sent = 0;
  await assert.rejects(probe([{ ...row('other'), user: 'other' }], async () => { sent++; })); assert.equal(sent, 0);
});
test('ambiguous sends are held with no retry', async () => {
  let attempts = 0; const result = await probe([row('native')], async () => { attempts++; throw new Error('connection lost'); });
  assert.equal(attempts, 1); assert.equal(result.status, 'unknown_do_not_retry'); assert.equal(result.accepted, 0);
});
test('rejected tokens are not pruned or treated as accepted', async () => {
  assert.deepEqual(await probe([row('native')], async () => ({ prune: true })), { status: 'invalid_device', accepted: 0 });
});
test('failed device lookup never reaches Firebase', async () => {
  let sent = 0;
  await assert.rejects(runNativeSelfTest({ env, recipients, directory: { list_device_tokens: async () => ({ Err: 'denied' }) }, send: async () => { sent++; } })); assert.equal(sent, 0);
});