import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ getIdentity: vi.fn(), getToken: vi.fn(), register: vi.fn(), mode: true }));
vi.mock('./icpPushMode', () => ({ usesDevIcpPush: () => state.mode, isDevIcpPushTarget: () => true }));
vi.mock('./internetIdentityAuth', () => ({ getCurrentInternetIdentity: state.getIdentity }));
vi.mock('./targetRegistry', () => ({ getActiveIcpTarget: () => ({}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capacitor-firebase/messaging', () => ({ FirebaseMessaging: { getToken: state.getToken } }));
vi.mock('./features/notifications', () => ({ registerLiveDeviceToken: state.register }));
import { initializeDevIcpNativePush } from './icpNativePush';

describe('ICP registration commissioning hold', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('IGNITE_LIVE_DEV_ICP_PUSH_ENABLED', undefined); });
  it('does not access identity, Firebase tokens or canisters before commissioning', async () => {
    expect(await initializeDevIcpNativePush('account-a')).toMatchObject({ success: false });
    expect(state.getIdentity).not.toHaveBeenCalled(); expect(state.getToken).not.toHaveBeenCalled(); expect(state.register).not.toHaveBeenCalled();
  });
});