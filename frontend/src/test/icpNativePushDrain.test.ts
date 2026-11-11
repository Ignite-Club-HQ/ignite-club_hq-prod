import { describe, expect, it, vi } from 'vitest';
import { drainNativePush } from '../../../supabase/functions/icp-dev-push-sender/drain';
import { deliverReservedNativePush, type Reservation } from '../../../supabase/functions/icp-dev-push-sender/delivery';

describe('native ICP burst draining', () => {
  it('delivers 25 authorized registrations across three batches without repeating any receipt', async () => {
    let cursor = 0;
    const rows: Reservation[] = Array.from({ length: 25 }, (_, i) => ({
      receipt: String(i), device: { user: `member-${i}`, token: `token-${i}`, platform: i % 2 ? 'ios' : 'android', active: true },
      payload: { notification: { title: 'Ignite', body: 'New update' }, data: { recipient: `member-${i}`, ignite_backend: 'icp-dev' } },
    }));
    const authority = { reserveNext: async () => rows[cursor++], settle: vi.fn().mockResolvedValue(true) };
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    expect(await drainNativePush(() => deliverReservedNativePush(authority, send), () => false)).toEqual({ batches: 3, complete: true });
    expect(send).toHaveBeenCalledTimes(25);
    expect(new Set(authority.settle.mock.calls.map(c => c[0])).size).toBe(25);
  });
  it('does not retry a lost settlement or request another batch', async () => {
    const batch = vi.fn().mockRejectedValue(new Error('Settlement unconfirmed'));
    await expect(drainNativePush(batch, () => true)).rejects.toThrow('Settlement unconfirmed');
    expect(batch).toHaveBeenCalledTimes(1);
  });
  it('stops at its time budget with remaining work on ICP', async () => {
    let clock = 0;
    const batch = vi.fn(async () => { clock += 11_000; return { accepted: 10, held: 0, inactive: 0, retry: 0, stopped: 0, complete: false }; });
    expect(await drainNativePush(batch, () => false, () => clock)).toEqual({ batches: 2, complete: false });
  });
});