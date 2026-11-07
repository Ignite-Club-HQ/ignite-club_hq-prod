import { usesDevIcpPush } from './icpPushMode';

interface Tap { recipient: string; path: string; id: string }
let installed = false;
let pending: Tap | undefined;
let consumer: { account: string; navigate: (path: string) => void } | undefined;
const seen = new Set<string>();

export function parseDevIcpPushTap(data: Record<string, unknown>): Tap | undefined {
  if (data.ignite_backend !== 'icp-dev' || typeof data.recipient !== 'string' ||
    typeof data.notification_id !== 'string' || typeof data.url !== 'string') return;
  if (data.url.length > 2048 || data.notification_id.length > 256 || !data.notification_id) return;
  // Only internal known app destinations; no external URLs, auth or invite redirects.
  if (!/^\/(messages|groups|events|notifications|news|media)(\/|\?|$)/.test(data.url) ||
    data.url.includes('\\') || /[\x00-\x1f]/.test(data.url)) return;
  return { recipient: data.recipient, path: data.url, id: data.notification_id };
}

function accept(tap: Tap) {
  if (!consumer || consumer.account !== tap.recipient || !usesDevIcpPush()) return;
  const key = `${tap.recipient}:${tap.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (seen.size > 100) seen.delete(seen.values().next().value ?? '');
  pending = undefined;
  consumer.navigate(tap.path);
}

export function receiveDevIcpPushTap(data: Record<string, unknown>) {
  if (!usesDevIcpPush()) return;
  const tap = parseDevIcpPushTap(data);
  if (!tap) return;
  pending = tap;
  accept(tap);
}

export function subscribeDevIcpPushTaps(account: string, navigate: (path: string) => void) {
  const subscription = { account, navigate };
  consumer = subscription;
  if (pending) accept(pending);
  return () => { if (consumer === subscription) consumer = undefined; };
}

export function clearDevIcpPushTaps() { pending = undefined; consumer = undefined; seen.clear(); }

export async function installDevIcpPushTaps() {
  if (installed || !usesDevIcpPush()) return;
  const { Capacitor } = await import('@capacitor/core');
  if (installed || !Capacitor.isNativePlatform() || !usesDevIcpPush()) return;
  installed = true;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.addListener('pushNotificationActionPerformed', notification => {
      receiveDevIcpPushTap(notification.notification.data ?? {});
    });
  } catch { installed = false; }
}