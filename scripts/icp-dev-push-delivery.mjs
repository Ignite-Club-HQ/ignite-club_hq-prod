// Offline-tested DEV delivery core. Not an executable, scheduler or deployment grant.
// An operator-authenticated adapter supplies fixed queues and a durable journal.
export function classifyDevFcmFailure(status, body) {
  const details = body?.error?.details ?? [];
  const fcmError = details.find(d => d?.['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode;
  if (fcmError === 'UNREGISTERED') return { action: 'deactivate', code: 'unregistered' };
  if (status === 429 || status >= 500) return { action: 'retry', code: `http-${status}` };
  // INVALID_ARGUMENT can mean invalid payload, not an invalid device token.
  return { action: 'stop', code: `http-${status}` };
}

export function devPushPayload(notification) {
  const id = notification.id;
  const related = notification.related_id?.[0];
  let url = '/notifications';
  if (notification.kind === 'message_chat' && (related || notification.club)) {
    url = `/messages?${new URLSearchParams({ conversation: related || notification.club, message: notification.idempotency_key })}`;
  } else if (notification.kind.startsWith('event') && related) {
    url = `/events/${encodeURIComponent(related)}`;
  } else if (notification.kind === 'club_news' && related) url = `/news/${encodeURIComponent(related)}`;
  // Generic lock-screen text even when preview is enabled: no PII or plaintext chat.
  return {
    notification: { title: 'Ignite Club HQ', body: 'You have a new update.' },
    data: { ignite_backend: 'icp-dev', recipient: notification.user, notification_id: id, kind: notification.kind, url },
    android: { priority: 'HIGH', notification: { channel_id: 'default', tag: id } },
    apns: { headers: { 'apns-priority': '10', 'apns-push-type': 'alert' }, payload: { aps: { sound: 'default' } } },
  };
}

/** Durable per-device send journal is mandatory. Unknown responses hold, never replay.
 * The adapter must implement fresh device/mute authorization and fenced source leases.
 * FCM acceptance is not proof of on-device display. */
export async function deliverDevPush({ queueId, notification, devices, authorize, send, journal, deactivate, now }) {
  const counts = { accepted: 0, inactive: 0, retry: 0, held: 0, denied: 0 };
  for (const device of devices) {
    if (device.user !== notification.user || device.active === false || !['android', 'ios'].includes(device.platform)) continue;
    const key = [queueId, notification.id, device.installationId, device.generation];
    const prior = await journal.read(key);
    if (prior?.status === 'accepted' || prior?.status === 'inactive') continue;
    if (prior?.status === 'sending' || prior?.status === 'held' || prior?.status === 'stopped') { counts.held++; continue; }
    if (prior?.nextAt > now()) { counts.retry++; continue; }
    const attempt = (prior?.attempt ?? 0) + 1;
    if (attempt > 5) { await journal.write(key, { status: 'stopped', attempt: attempt - 1 }); counts.held++; continue; }
    // Must check device generation, notification lease, current membership/mute/preferences.
    if (!await authorize(notification, device)) { counts.denied++; continue; }
    await journal.write(key, { status: 'sending', attempt });
    let result;
    try { result = await send(device, devPushPayload(notification)); }
    catch {
      await journal.write(key, { status: 'held', attempt }); counts.held++; continue;
    }
    if (result.ok) {
      await journal.write(key, { status: 'accepted', attempt }); counts.accepted++; continue;
    }
    const policy = classifyDevFcmFailure(result.status, result.body);
    if (policy.action === 'deactivate') {
      await deactivate(device);
      await journal.write(key, { status: 'inactive', attempt }); counts.inactive++;
    } else if (policy.action === 'retry') {
      await journal.write(key, { status: 'retry', attempt, nextAt: now() + Math.min(120000 * 2 ** (attempt - 1), 1800000), code: policy.code });
      counts.retry++;
    } else {
      await journal.write(key, { status: 'stopped', attempt, code: policy.code }); counts.held++;
    }
  }
  return { ...counts, complete: counts.retry === 0 && counts.held === 0 && counts.denied === 0 };
}