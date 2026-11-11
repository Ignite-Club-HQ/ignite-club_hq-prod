import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({ icp: false, revoke: vi.fn(async () => {}) }));
vi.mock('@/live/icpPushMode', () => ({ usesDevIcpPush: () => m.icp }));
vi.mock('@/live/icpNativePush', () => ({ revokeDevIcpNativePush: m.revoke }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
import { unregisterNativePush } from './nativePush';

describe('sign-out alert cleanup picks the current sign-in method', () => {
  beforeEach(() => m.revoke.mockClear());
  it('Internet Identity sign-out removes the phone from ICP alerts', async () => {
    m.icp = true;
    await unregisterNativePush('principal-1');
    expect(m.revoke).toHaveBeenCalledTimes(1);
  });
  it('email sign-out never touches ICP alert registration', async () => {
    m.icp = false;
    await unregisterNativePush('email-user');
    expect(m.revoke).not.toHaveBeenCalled();
  });
});
