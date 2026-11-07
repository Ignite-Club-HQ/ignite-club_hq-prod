import type { PluginListenerHandle } from '@capacitor/core';
import type { Identity } from '@icp-sdk/core/agent';
import type { IcpTargetConfig } from './targetRegistry';
import { createIcpPushLifecycle } from './icpPushLifecycle';
import { isDevIcpPushTarget, usesDevIcpPush } from './icpPushMode';

const lifecycle = createIcpPushLifecycle();
let currentTicket: number | undefined;
let activeAccount: string | undefined;
let detach: (() => void) | undefined;
let initialization: Promise<{ success: boolean; error?: string }> | undefined;

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
  if (initialization) return initialization.then(() => initialize(userId, requestPermission));
  initialization = initialize(userId, requestPermission).finally(() => { initialization = undefined; });
  return initialization;
}

async function initialize(userId: string, requestPermission: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return { success: false, error: 'Not a native app' };
    const platform = Capacitor.getPlatform();
    if (platform !== 'android' && platform !== 'ios') return { success: false, error: 'Unsupported phone' };
    const ctx = await ownerContext(userId);
    const account = ctx.identity.getPrincipal().toText();
    const { registerLiveDeviceToken, unregisterLiveDeviceToken } = await import('./features/notifications');
    const ticket = lifecycle.bind({ account, target: JSON.stringify([ctx.target.host, ctx.target.canisterIds]),
      register: (token, p) => registerLiveDeviceToken(ctx, { token, platform: p }),
      unregister: async token => { await unregisterLiveDeviceToken(ctx, token); },
    });
    currentTicket = ticket;
    activeAccount = account;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' && requestPermission) permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') {
      await revokeDevIcpNativePush();
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
    handles.push(tokenHandle);
    const receivedHandle = await PushNotifications.addListener('pushNotificationReceived', notification => {
      const data = notification.data;
      if (disposed || !lifecycle.isCurrent(ticket) || !usesDevIcpPush() ||
        data?.ignite_backend !== 'icp-dev' || data?.recipient !== account) return;
      window.dispatchEvent(new CustomEvent('ignite:icp-push-received', { detail: notification }));
    });
    handles.push(receivedHandle);
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