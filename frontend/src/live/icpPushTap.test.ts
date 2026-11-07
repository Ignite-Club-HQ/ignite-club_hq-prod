import { describe, expect, it, vi } from 'vitest';
vi.mock('./icpPushMode', () => ({ usesDevIcpPush: () => true }));
import { parseDevIcpPushTap } from './icpPushTap';
const data = { ignite_backend: 'icp-dev', recipient: 'account-a', notification_id: 'n-1', url: '/messages?conversation=c-1&message=m-1' };
describe('ICP-only tap envelope', () => {
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