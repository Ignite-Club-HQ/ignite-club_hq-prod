import { describe, expect, it, vi } from 'vitest';
import { enableDevIcpBrowserPush } from './icpBrowserPush';

const config = { apiKey: 'public-test-key', projectId: 'test-project', appId: '1:123:web:abc', vapidKey: 'public-test-vapid' };
function setup() {
  const authority = { ready: vi.fn().mockResolvedValue(true), isCurrent: vi.fn().mockReturnValue(true),
    register: vi.fn().mockResolvedValue(undefined), unregister: vi.fn().mockResolvedValue(undefined) };
  const browser = { isDev: vi.fn().mockReturnValue(true), isTopLevel: vi.fn().mockReturnValue(true),
    supported: vi.fn().mockResolvedValue(true), permission: vi.fn().mockReturnValue('default'),
    requestPermission: vi.fn().mockResolvedValue('granted'), token: vi.fn().mockResolvedValue('test-device-token') };
  return { authority, browser };
}
describe('isolated DEV browser push', () => {
  it('never acquires tokens or registers in Supabase/PROD mode', async () => {
    const { authority, browser } = setup(); browser.isDev.mockReturnValue(false);
    expect(await enableDevIcpBrowserPush(config, authority, browser)).toEqual({ status: 'unsupported' });
    expect(browser.token).not.toHaveBeenCalled(); expect(authority.register).not.toHaveBeenCalled();
  });
  it('rejects native app IDs rather than using them for web messaging', async () => {
    const { authority, browser } = setup();
    expect(await enableDevIcpBrowserPush({ ...config, appId: '1:123:android:abc' }, authority, browser)).toEqual({ status: 'not-configured' });
    expect(browser.requestPermission).not.toHaveBeenCalled();
  });
  it('asks iframe users to open their own tab without prompting', async () => {
    const { authority, browser } = setup(); browser.isTopLevel.mockReturnValue(false);
    expect(await enableDevIcpBrowserPush(config, authority, browser)).toEqual({ status: 'open-in-new-tab' });
    expect(browser.requestPermission).not.toHaveBeenCalled();
  });
  it('does not register or prompt until server commissioning is confirmed', async () => {
    const { authority, browser } = setup(); authority.ready.mockResolvedValue(false);
    expect(await enableDevIcpBrowserPush(config, authority, browser)).toEqual({ status: 'setup-pending' });
    expect(browser.token).not.toHaveBeenCalled(); expect(browser.requestPermission).not.toHaveBeenCalled();
  });
  it('does not register after permission is denied', async () => {
    const { authority, browser } = setup(); browser.requestPermission.mockResolvedValue('denied');
    expect(await enableDevIcpBrowserPush(config, authority, browser)).toEqual({ status: 'denied' });
    expect(authority.register).not.toHaveBeenCalled();
  });
  it('registers only through the captured authenticated authority', async () => {
    const { authority, browser } = setup();
    expect(await enableDevIcpBrowserPush(config, authority, browser)).toEqual({ status: 'registered' });
    expect(authority.register).toHaveBeenCalledExactlyOnceWith('test-device-token');
  });
  it('cleans up a registration if the account changes while saving', async () => {
    const { authority, browser } = setup();
    authority.register.mockImplementation(async () => { authority.isCurrent.mockReturnValue(false); });
    expect(await enableDevIcpBrowserPush(config, authority, browser)).toEqual({ status: 'account-changed' });
    expect(authority.unregister).toHaveBeenCalledExactlyOnceWith('test-device-token');
  });
  it('does not retry an uncertain registration', async () => {
    const { authority, browser } = setup(); authority.register.mockRejectedValue(new Error('reply lost'));
    await expect(enableDevIcpBrowserPush(config, authority, browser)).rejects.toThrow('reply lost');
    expect(authority.register).toHaveBeenCalledTimes(1);
    expect(authority.unregister).toHaveBeenCalledExactlyOnceWith('test-device-token');
  });
});