import { describe, expect, it, vi } from 'vitest';
import { deliverBrowserSelfTest } from '../../../supabase/functions/icp-dev-push-test/delivery';
describe('one-shot browser test delivery', () => {
  it('cannot send without an authoritative pending claim', async () => {
    const send = vi.fn(); const settle = vi.fn();
    expect(await deliverBrowserSelfTest('12345678-1234-1234', { claim: async () => undefined, settle }, send)).toEqual({ status: 'not-pending' });
    expect(send).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled();
  });
  it('sends the claimed token once and records provider acceptance', async () => {
    const row = { id: '12345678-1234-1234', token: 'claimed-device', owner: 'signed-owner' };
    const send = vi.fn().mockResolvedValue(true); const settle = vi.fn();
    expect(await deliverBrowserSelfTest(row.id, { claim: async () => row, settle }, send)).toEqual({ status: 'accepted' });
    expect(send).toHaveBeenCalledExactlyOnceWith(row); expect(settle).toHaveBeenCalledExactlyOnceWith(row.id, 'accepted');
  });
  it('holds unknown sends without retry', async () => {
    const row = { id: '12345678-1234-1234', token: 'device', owner: 'owner' };
    const send = vi.fn().mockRejectedValue(new Error('timeout')); const settle = vi.fn();
    expect(await deliverBrowserSelfTest(row.id, { claim: async () => row, settle }, send)).toEqual({ status: 'held' });
    expect(send).toHaveBeenCalledTimes(1); expect(settle).toHaveBeenCalledExactlyOnceWith(row.id, 'held');
  });
  it('concurrent triggers send only the atomically claimed test', async () => {
    let pending = true;
    const row = { id: '12345678-1234-1234', token: 'device', owner: 'owner' };
    const queue = { claim: async () => { if (!pending) return undefined; pending = false; return row; }, settle: vi.fn() };
    const send = vi.fn().mockResolvedValue(true);
    await Promise.all([deliverBrowserSelfTest(row.id, queue, send), deliverBrowserSelfTest(row.id, queue, send)]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('lost settlement never automatically repeats the provider call', async () => {
    const row = { id: '12345678-1234-1234', token: 'device', owner: 'owner' };
    const send = vi.fn().mockResolvedValue(true);
    await expect(deliverBrowserSelfTest(row.id, { claim: async () => row, settle: async () => { throw new Error('lost receipt'); } }, send)).rejects.toThrow('lost receipt');
    expect(send).toHaveBeenCalledTimes(1);
  });
});