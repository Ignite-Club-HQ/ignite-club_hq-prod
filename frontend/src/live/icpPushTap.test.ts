import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./icpPushMode', () => ({ usesDevIcpPush: () => true }));
import { clearDevIcpPushTaps, parseDevIcpPushTap, receiveDevIcpPushTap, subscribeDevIcpPushTaps } from './icpPushTap';
const data = { ignite_backend: 'icp-dev', recipient: 'account-a', notification_id: 'n-1', url: '/messages?conversation=c-1&message=m-1' };
describe('ICP-only tap envelope', () => {
  beforeEach(clearDevIcpPushTaps);
  it('holds a cold tap for its own signed-in account and navigates only once', () => {
    receiveDevIcpPushTap(data);
    const wrong = vi.fn(); subscribeDevIcpPushTaps('account-b', wrong);
    expect(wrong).not.toHaveBeenCalled();
    const own = vi.fn(); subscribeDevIcpPushTaps('account-a', own);
    receiveDevIcpPushTap(data);
    expect(own).toHaveBeenCalledTimes(1); expect(own).toHaveBeenCalledWith(data.url);
  });
  it('does not retain a pending old-account tap after logout', () => {
    receiveDevIcpPushTap(data); clearDevIcpPushTaps();
    const navigate = vi.fn(); subscribeDevIcpPushTaps('account-a', navigate);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('retains the recipient for authenticated account matching', () => {
    expect(parseDevIcpPushTap(data)).toEqual({ recipient: 'account-a', id: 'n-1', path: data.url });
  });
  it('ignores existing email payloads and PROD ICP payloads', () => {
    expect(parseDevIcpPushTap({ ...data, ignite_backend: undefined })).toBeUndefined();
    expect(parseDevIcpPushTap({ ...data, ignite_backend: 'icp-prod' })).toBeUndefined();
  });
  it.each(['https://evil.example', '//evil.example', '/auth', '/join/secret', '/messages\\evil', '/events\n'])('rejects unsafe route %s', url => {
    expect(parseDevIcpPushTap({ ...data, url })).toBeUndefined();
  });
});