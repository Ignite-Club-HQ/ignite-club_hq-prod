import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handOverPushToken, markSecurePushRegistered, securePushRegistrationPending } from './pushTokenHandover';

const messaging = () => ({ deleteToken: vi.fn().mockResolvedValue(undefined), getToken: vi.fn().mockResolvedValue({ token: 'fresh' }) });

describe('push token handover', () => {
  beforeEach(() => localStorage.clear());
  it('keeps the token when the phone was never on secure servers', async () => {
    const m = messaging();
    expect(await handOverPushToken('old', m)).toBe('old');
    expect(m.deleteToken).not.toHaveBeenCalled();
  });
  it('rotates the token after a secure registration', async () => {
    markSecurePushRegistered();
    const m = messaging();
    expect(await handOverPushToken('old', m)).toBe('fresh');
    expect(m.deleteToken).toHaveBeenCalledTimes(1);
    expect(securePushRegistrationPending()).toBe(false);
  });
  it('falls back to the old token if rotation fails', async () => {
    markSecurePushRegistered();
    const m = messaging(); m.deleteToken.mockRejectedValue(new Error('x'));
    expect(await handOverPushToken('old', m)).toBe('old');
    expect(securePushRegistrationPending()).toBe(true);
  });
});
