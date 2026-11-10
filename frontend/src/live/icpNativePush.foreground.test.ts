import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mode: true,
  platform: 'android',
  push: new Map<string, (event: any) => void>(),
  firebase: new Map<string, (event: any) => void>(),
  present: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./icpPushMode', () => ({ usesDevIcpPush: () => state.mode, isDevIcpPushTarget: () => true }));
vi.mock('./internetIdentityAuth', () => ({ getCurrentInternetIdentity: async () => ({
  getPrincipal: () => ({ isAnonymous: () => false, toText: () => 'account-a' }),
}) }));
vi.mock('./targetRegistry', () => ({ getActiveIcpTarget: () => ({ host: 'https://icp-api.io', canisterIds: {} }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => state.platform },
  registerPlugin: () => ({ present: state.present }) }));
vi.mock('./features/notifications', () => ({ registerLiveDeviceToken: async () => undefined, unregisterLiveDeviceToken: async () => undefined }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  checkPermissions: async () => ({ receive: 'granted' }),
  addListener: async (name: string, callback: (event: any) => void) => {
    state.push.set(name, callback);
    return { remove: async () => { state.push.delete(name); } };
  },
  register: async () => { state.push.get('registration')?.({}); },
} }));
vi.mock('@capacitor-firebase/messaging', () => ({ FirebaseMessaging: {
  getToken: async () => ({ token: 'phone-token' }),
  addListener: async (name: string, callback: (event: any) => void) => {
    state.firebase.set(name, callback);
    return { remove: async () => { state.firebase.delete(name); } };
  },
} }));
import { initializeDevIcpNativePush, revokeDevIcpNativePush } from './icpNativePush';

const notification = (id = 'alert-1', recipient = 'account-a', backend = 'icp-dev') => ({
  id, data: { notification_id: id, recipient, ignite_backend: backend },
});

beforeEach(() => {
  state.mode = true; state.platform = 'android';
  state.present.mockClear();
  vi.stubEnv('IGNITE_LIVE_DEV_ICP_PUSH_ENABLED', 'true');
});
afterEach(async () => { await revokeDevIcpNativePush(); vi.unstubAllEnvs(); });

it.each(['android', 'ios'])('receives Firebase foreground notifications on %s once across both plugins', async platform => {
  state.platform = platform;
  expect(await initializeDevIcpNativePush('account-a', false)).toEqual({ success: true });
  const received = vi.fn();
  window.addEventListener('ignite:icp-push-received', received);
  try {
    state.firebase.get('notificationReceived')?.({ notification: notification() });
    expect(received).toHaveBeenCalledTimes(1);
    state.push.get('pushNotificationReceived')?.(notification());
    expect(received).toHaveBeenCalledTimes(1);
    state.firebase.get('notificationReceived')?.({ notification: notification('alert-2') });
    expect(received).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      expect(state.present).toHaveBeenCalledTimes(platform === 'android' ? 2 : 0);
    });
    if (platform === 'android') expect(state.present).toHaveBeenCalledWith({
      backend: 'icp-dev', recipient: 'account-a', account: 'account-a', id: 'alert-1', url: '/notifications',
    });
  } finally { window.removeEventListener('ignite:icp-push-received', received); }
});

it('ignores other accounts, email payloads, switched modes and retired listeners', async () => {
  await initializeDevIcpNativePush('account-a', false);
  const receive = state.firebase.get('notificationReceived');
  expect(receive).toBeTypeOf('function');
  const received = vi.fn();
  window.addEventListener('ignite:icp-push-received', received);
  try {
    receive?.({ notification: notification('wrong-account', 'account-b') });
    receive?.({ notification: notification('email', 'account-a', 'supabase') });
    state.mode = false;
    receive?.({ notification: notification('switched') });
    state.mode = true;
    await revokeDevIcpNativePush();
    receive?.({ notification: notification('retired') });
    expect(received).not.toHaveBeenCalled();
    expect(state.present).not.toHaveBeenCalled();
    expect(state.firebase.has('notificationReceived')).toBe(false);
  } finally { window.removeEventListener('ignite:icp-push-received', received); }
});

it('does not re-present PushNotifications receipts already displayed by the native plugin', async () => {
  await initializeDevIcpNativePush('account-a', false);
  state.push.get('pushNotificationReceived')?.(notification());
  state.firebase.get('notificationReceived')?.({ notification: notification() });
  await Promise.resolve();
  expect(state.present).not.toHaveBeenCalled();
});