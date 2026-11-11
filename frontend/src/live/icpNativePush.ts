import type { PluginListenerHandle } from '@capacitor/core';
import type { Identity } from '@icp-sdk/core/agent';
import type { IcpTargetConfig } from './targetRegistry';
import { createIcpPushLifecycle } from './icpPushLifecycle';
import { groupPushQueues, isDevIcpPushTarget, usesDevIcpPush } from './icpPushMode';

const lifecycle = createIcpPushLifecycle();
let currentTicket: number | undefined;
let activeAccount: string | undefined;
let detach: (() => void) | undefined;
let initialization: { account: string; requestPermission: boolean; attempt: number; promise: Promise<{ success: boolean; error?: string }> } | undefined;
let epoch = 0;

async function ownerContext(userId: string): Promise<{ identity: Identity; target: IcpTargetConfig }> {
  const [{ getCurrentInternetIdentity }, { getActiveIcpTarget }] = await Promise.all([
    import('./internetIdentityAuth'), import('./targetRegistry'),
  ]);
  const identity = await getCurrentInternetIdentity();
  const target = getActiveIcpTarget();
  if (!usesDevIcpPush() || !isDevIcpPushTarget(target) || !identity ||
    identity.getPrincipal().isAnonymous() || identity.getPrincipal().toText() !== userId.replace(/^principal:/, '')) {
    throw new Error('Push registration requires the current TEST account');
  }
  return { identity, target };
}

/** Separate native adapter. Existing Firebase/Capacitor configuration is not changed. */
export function initializeDevIcpNativePush(userId: string, requestPermission = true) {
  const account = userId.replace(/^principal:/, '');
  if (initialization?.account === account && initialization.attempt === epoch) {
    if (!requestPermission || initialization.requestPermission) return initialization.promise;
    return initialization.promise.then(() => initializeDevIcpNativePush(userId, true));
  }
  const attempt = ++epoch;
  const promise = initialize(userId, requestPermission, attempt).finally(() => {
    if (initialization?.attempt === attempt) initialization = undefined;
  });
  initialization = { account, requestPermission, attempt, promise };
  return promise;
}

async function initialize(userId: string, requestPermission: boolean, attempt: number): Promise<{ success: boolean; error?: string }> {
  try {
    // Commission only after directory ownership, gateway and dual-mode phone acceptance.
    // An uncommissioned ICP adapter never drops through to legacy Supabase delivery.
    // Gated by usesDevIcpPush (exact TEST or LIVE queue + sign-in services);
    // no separate build flag, which store builds never set.
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return { success: false, error: 'Not a native app' };
    const platform = Capacitor.getPlatform();
    if (platform !== 'android' && platform !== 'ios') return { success: false, error: 'Unsupported phone' };
    const ctx = await ownerContext(userId);
    if (attempt !== epoch) return { success: false, error: 'Account changed' };
    const account = ctx.identity.getPrincipal().toText();
    const { registerLiveDeviceToken, unregisterLiveDeviceToken } = await import('./features/notifications');
    if (attempt !== epoch || !usesDevIcpPush()) return { success: false, error: 'Account changed' };
    const groupCtxs = groupPushQueues(ctx.target).map(queue => ({ ...ctx,
      target: { ...ctx.target, canisterIds: { ...ctx.target.canisterIds, notification_queue: queue } } }));
    const ticket = lifecycle.bind({ account, target: JSON.stringify([ctx.target.host, ctx.target.canisterIds]),
      register: async (token, p) => {
        await registerLiveDeviceToken(ctx, { token, platform: p });
        // Other member groups: best-effort, so a group outage never blocks main-group alerts.
        await Promise.all(groupCtxs.map(g => registerLiveDeviceToken(g, { token, platform: p })
          .catch(() => console.warn('[ICP push] Group alert link not confirmed'))));
      },
      unregister: async token => {
        await Promise.all(groupCtxs.map(g => unregisterLiveDeviceToken(g, token)
          .catch(() => console.warn('[ICP push] Group alert removal not confirmed'))));
        await unregisterLiveDeviceToken(ctx, token);
      },
    });
    currentTicket = ticket;
    activeAccount = account;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    let permission = await PushNotifications.checkPermissions();
    if (attempt !== epoch || !usesDevIcpPush()) return { success: false, error: 'Account changed' };
    if (permission.receive === 'prompt' && requestPermission) permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') {
      if (attempt === epoch) await revokeDevIcpNativePush();
      return { success: false, error: 'Notifications are not enabled on this phone' };
    }
    if (!lifecycle.isCurrent(ticket) || !usesDevIcpPush()) return { success: false, error: 'Account changed' };
    detach?.();
    const handles: PluginListenerHandle[] = [];
    let disposed = false;
    detach = () => { disposed = true; handles.forEach(handle => { void handle.remove().catch(() => undefined); }); };
    // No plugin-wide removeAllListeners or second action listener.
    const tokenHandle = await FirebaseMessaging.addListener('tokenReceived', event => {
      if (disposed || !lifecycle.isCurrent(ticket) || !usesDevIcpPush()) return;
      void lifecycle.register(ticket, event.token, platform).catch(() => {
        window.dispatchEvent(new CustomEvent('ignite:icp-push-registration-failed'));
      });
    });
    if (disposed) await tokenHandle.remove(); else handles.push(tokenHandle);
    // Either installed plugin may own Android's FCM service. Consume both
    // receive events, never alter their shared presentation configuration.
    const seen = new Set<string>();
    const receive = (notification: { id?: string; data?: unknown }, source: 'push' | 'firebase') => {
      const raw = notification.data;
      const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined;
      if (disposed || !lifecycle.isCurrent(ticket) || !usesDevIcpPush() ||
        data?.ignite_backend !== 'icp-dev' || data?.recipient !== account) return;
      const id = typeof data.notification_id === 'string' ? data.notification_id : notification.id;
      if (!id || seen.has(id)) return;
      seen.add(id);
      if (seen.size > 100) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      // PushNotifications already presents its own receive event. Only bridge
      // Firebase-owned Android receipts, after the same account/session checks.
      if (platform === 'android' && source === 'firebase') {
        void registerPlugin<{ present(options: { backend: string; recipient: string; account: string; id: string; url: string }): Promise<void> }>(
            'IcpForegroundPush',
          ).present({ backend: 'icp-dev', recipient: account, account, id,
            url: typeof data.url === 'string' ? data.url : '/notifications' }).catch(() => {
          console.warn('[ICP push] System notification presentation unavailable');
        });
      }
      window.dispatchEvent(new CustomEvent('ignite:icp-push-received', { detail: notification }));
    };
    const receivedHandle = await PushNotifications.addListener('pushNotificationReceived', notification => receive(notification, 'push'));
    if (disposed) await receivedHandle.remove(); else handles.push(receivedHandle);
    const firebaseReceivedHandle = await FirebaseMessaging.addListener('notificationReceived', event => receive(event.notification, 'firebase'));
    if (disposed) await firebaseReceivedHandle.remove(); else handles.push(firebaseReceivedHandle);
    if (disposed || !lifecycle.isCurrent(ticket) || !usesDevIcpPush()) return { success: false, error: 'Account changed' };
    // Wait for APNs readiness on iOS; its registration value is never used as FCM.
    let registrationHandle: PluginListenerHandle | undefined;
    let errorHandle: PluginListenerHandle | undefined;
    let finish: (() => void) | undefined;
    const ready = new Promise<void>(resolve => { finish = resolve; });
    const timer = window.setTimeout(() => finish?.(), 12000);
    try {
      registrationHandle = await PushNotifications.addListener('registration', () => finish?.());
      errorHandle = await PushNotifications.addListener('registrationError', () => finish?.());
      await PushNotifications.register();
      await ready;
    } finally {
      window.clearTimeout(timer);
      await registrationHandle?.remove();
      await errorHandle?.remove();
    }
    if (!lifecycle.isCurrent(ticket) || !usesDevIcpPush()) return { success: false, error: 'Account changed' };
    const { token } = await FirebaseMessaging.getToken();
    if (!lifecycle.isCurrent(ticket) || !usesDevIcpPush()) return { success: false, error: 'Account changed' };
    const registered = await lifecycle.register(ticket, token, platform);
    return registered ? { success: true } : { success: false, error: 'Account changed' };
  } catch {
    return { success: false, error: 'Could not enable TEST notifications. Please try again.' };
  }
}

export async function revokeDevIcpNativePush(): Promise<void> {
  epoch += 1;
  currentTicket = undefined;
  activeAccount = undefined;
  detach?.();
  detach = undefined;
  // Revoke using captured identity BEFORE the auth session is cleared.
  await lifecycle.revoke();
}

export function refreshDevIcpNativePush() {
  const ticket = currentTicket;
  if (!ticket || !usesDevIcpPush()) return Promise.resolve();
  return lifecycle.refresh(ticket);
}

export function devIcpPushAccount() { return activeAccount; }

export function releaseDevIcpNativePush(userId: string) {
  const account = userId.replace(/^principal:/, '');
  // Stale effect cleanup must not revoke the newly bound account.
  if (initialization?.account !== account && activeAccount !== account) return Promise.resolve();
  return revokeDevIcpNativePush();
}