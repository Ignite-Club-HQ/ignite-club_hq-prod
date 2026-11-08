import { describe, expect, it, vi } from 'vitest';
import { createIcpPushLifecycle, type IcpPushOwner } from './icpPushLifecycle';

function owner(account: string): IcpPushOwner {
  return { account, target: 'test-queue', register: vi.fn().mockResolvedValue(undefined), unregister: vi.fn().mockResolvedValue(undefined) };
}

describe('ICP-only installation lifecycle', () => {
  it('registers only the bound caller and reuses the same device without duplicate writes', async () => {
    const lifecycle = createIcpPushLifecycle(); const a = owner('a');
    const ticket = lifecycle.bind(a);
    await lifecycle.register(ticket, 'test-token', 'android');
    await lifecycle.register(ticket, 'test-token', 'android');
    expect(a.register).toHaveBeenCalledTimes(1);
    expect(a.register).toHaveBeenCalledWith('test-token', 'android');
  });
  it('removes the old account association before a new account registers', async () => {
    const lifecycle = createIcpPushLifecycle(); const a = owner('a'); const b = owner('b');
    const order: string[] = [];
    a.unregister = vi.fn(async () => { order.push('remove-a'); });
    b.register = vi.fn(async () => { order.push('register-b'); });
    await lifecycle.register(lifecycle.bind(a), 'test-token', 'ios');
    await lifecycle.register(lifecycle.bind(b), 'test-token', 'ios');
    expect(order).toEqual(['remove-a', 'register-b']);
  });
  it('does not register a new account when old-account removal is unconfirmed', async () => {
    const lifecycle = createIcpPushLifecycle(); const a = owner('a'); const b = owner('b');
    await lifecycle.register(lifecycle.bind(a), 'test-token', 'android');
    a.unregister = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(lifecycle.register(lifecycle.bind(b), 'test-token', 'android')).rejects.toThrow('offline');
    expect(b.register).not.toHaveBeenCalled();
  });
  it('discards token refresh for the previous account after switching', async () => {
    const lifecycle = createIcpPushLifecycle(); const a = owner('a'); const b = owner('b');
    const old = lifecycle.bind(a); lifecycle.bind(b);
    expect(await lifecycle.register(old, 'old-token', 'android')).toBe(false);
    expect(a.register).not.toHaveBeenCalled(); expect(b.register).not.toHaveBeenCalled();
  });
  it('compensates an in-flight registration on logout using the captured signer', async () => {
    const lifecycle = createIcpPushLifecycle(); const a = owner('a');
    let finish: (() => void) | undefined;
    a.register = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const registering = lifecycle.register(lifecycle.bind(a), 'test-token', 'ios');
    await Promise.resolve();
    const revoke = lifecycle.revoke(); finish?.();
    expect(await registering).toBe(false); await revoke;
    expect(a.unregister).toHaveBeenCalledTimes(1);
  });
  it('revokes an uncertain registration without automatically replaying it', async () => {
    const lifecycle = createIcpPushLifecycle(); const a = owner('a');
    a.register = vi.fn().mockRejectedValue(new Error('unknown response'));
    await expect(lifecycle.register(lifecycle.bind(a), 'test-token', 'android')).rejects.toThrow();
    await lifecycle.revoke();
    expect(a.register).toHaveBeenCalledTimes(1);
    expect(a.unregister).toHaveBeenCalledWith('test-token');
  });
  it('clears an uncertain prior intent before retrying registration', async () => {
    const lifecycle = createIcpPushLifecycle(); const a = owner('a');
    const ticket = lifecycle.bind(a);
    a.register = vi.fn().mockRejectedValueOnce(new Error('lost reply')).mockResolvedValue(undefined);
    await expect(lifecycle.register(ticket, 'test-token', 'ios')).rejects.toThrow();
    await lifecycle.register(ticket, 'test-token', 'ios');
    expect(a.unregister).toHaveBeenCalledTimes(1);
    expect(a.register).toHaveBeenCalledTimes(2);
  });
  it('rotates one installation without removing other devices', async () => {
    const lifecycle = createIcpPushLifecycle(); const a = owner('a'); const ticket = lifecycle.bind(a);
    await lifecycle.register(ticket, 'old-token', 'ios');
    await lifecycle.register(ticket, 'new-token', 'ios');
    expect(a.unregister).toHaveBeenCalledWith('old-token');
    expect(a.unregister).toHaveBeenCalledTimes(1);
    expect(a.register).toHaveBeenLastCalledWith('new-token', 'ios');
  });
});