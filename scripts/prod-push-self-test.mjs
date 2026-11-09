// One manual transport probe; no notification rows, recovery, pruning or retries.
export const PAUL_PUSH_TEST_RECIPIENT = 'uuq6o-np4vy-sv6o7-ongim-26u3l-uje3n-abouz-7fi33-fwbkk-np27z-rae';

export function validateSelfTest(env, recipients) {
  if (env.GITHUB_REPOSITORY !== 'Ignite-Club-HQ/ignite-club_hq-prod' ||
      env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      env.GITHUB_REF !== 'refs/heads/prod' || env.IGNITE_ICP_ENV !== 'prod' ||
      env.ICP_PUSH_NATIVE_SELF_TEST !== 'true') throw new Error('Native self-test requires an explicit manual PROD run');
  if (recipients?.size !== 1 || !recipients.has(PAUL_PUSH_TEST_RECIPIENT)) throw new Error('Native self-test is restricted to Paul only');
  return PAUL_PUSH_TEST_RECIPIENT;
}

export async function runNativeSelfTest({ env, recipients, directory, send, now = Date.now }) {
  const user = validateSelfTest(env, recipients);
  const reply = await directory.list_device_tokens([user]);
  if (!reply || !('Ok' in reply) || !Array.isArray(reply.Ok)) throw new Error('Native device lookup failed; no test sent');
  // Refuse unexpected ownership, even if the directory returns extra rows.
  if (reply.Ok.some(row => row.user !== user)) throw new Error('Native device ownership mismatch; no test sent');
  const devices = reply.Ok.filter(row => (row.platform === 'android' || row.platform === 'ios') && typeof row.token === 'string' && row.token.length > 0);
  // Exactly one registered native device. Never broadcast to all installations.
  const device = devices.reduce((latest, row) => !latest || BigInt(row.updated_at_ms) > BigInt(latest.updated_at_ms) ? row : latest, undefined);
  if (!device) return { status: 'no_device', accepted: 0 };
  const id = `native-self-test-${env.GITHUB_RUN_ID ?? now()}`;
  const notification = { id, user, club: 'app', kind: 'native_push_test', body: 'This is your Ignite native push test.', idempotency_key: id, related_id: [] };
  try {
    const error = await send(device.token, notification);
    return error ? { status: error.prune ? 'invalid_device' : 'failed', accepted: 0 } : { status: 'accepted_by_firebase', accepted: 1 };
  } catch {
    // Firebase may have accepted the request before the connection was lost.
    return { status: 'unknown_do_not_retry', accepted: 0 };
  }
}