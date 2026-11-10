import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ getIdentity: vi.fn(), getToken: vi.fn(), register: vi.fn(), mode: true }));
vi.mock('./icpPushMode', () => ({ usesDevIcpPush: () => state.mode, isDevIcpPushTarget: () => true }));
vi.mock('./internetIdentityAuth', () => ({ getCurrentInternetIdentity: state.getIdentity }));
vi.mock('./targetRegistry', () => ({ getActiveIcpTarget: () => ({}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capacitor-firebase/messaging', () => ({ FirebaseMessaging: { getToken: state.getToken } }));
vi.mock('./features/notifications', () => ({ registerLiveDeviceToken: state.register }));
import { initializeDevIcpNativePush } from './icpNativePush';

describe('ICP phone linking in store builds', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('IGNITE_LIVE_DEV_ICP_PUSH_ENABLED', undefined); });
  it('does not refuse just because the build flag is unset (store builds never set it)', async () => {
    state.getIdentity.mockResolvedValue(null);
    const result = await initializeDevIcpNativePush('account-a');
    expect(result.error).not.toBe('TEST push setup is not complete yet');
  });
});
