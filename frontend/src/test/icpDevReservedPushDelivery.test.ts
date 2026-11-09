import { describe, expect, it, vi } from 'vitest';
import { deliverReservedNativePush, type Reservation } from '../../../supabase/functions/icp-dev-push-sender/delivery';
import { nativeSenderSigningSeed } from '../../../supabase/functions/icp-dev-push-sender/signing';
import { createDevFcmTransport } from '../../../supabase/functions/icp-dev-push-sender/fcm';

const row = (): Reservation => ({
  receipt: 'icp-owned-attempt-1',
  device: { user: 'account-a', token: 'synthetic-device-token', platform: 'android', active: true },
  payload: { notification: { title: 'Ignite Club HQ', body: 'You have a new update.' }, data: {
    ignite_backend: 'icp-dev', recipient: 'account-a', notification_id: 'n-1', kind: 'message_chat', url: '/notifications',
  } },
});
const config = { supabaseUrl: 'https://ecsdwrarzfexssxtrymj.supabase.co', lovableKey: 'fixture-only', connectionKey: 'fixture-only' };
function setup() {
  const authority = { reserveNext: vi.fn().mockResolvedValueOnce(row()).mockResolvedValue(undefined), settle: vi.fn().mockResolvedValue(true) };
  const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  return { authority, send };
}

describe('ICP-owned reservations with Supabase-only transport', () => {
  it('sends the ICP-selected native envelope and writes acceptance back to ICP', async () => {
    const args = setup();
    expect(await deliverReservedNativePush(args.authority, args.send)).toMatchObject({ accepted: 1, complete: true });
    expect(args.send).toHaveBeenCalledExactlyOnceWith(row().device, row().payload);
    expect(args.authority.settle).toHaveBeenCalledExactlyOnceWith('icp-owned-attempt-1', { status: 'accepted' });
  });
  it('makes no provider request if no ICP reservation exists', async () => {
    const args = setup(); args.authority.reserveNext.mockReset().mockResolvedValue(undefined);
    expect(await deliverReservedNativePush(args.authority, args.send)).toMatchObject({ accepted: 0, complete: true });
    expect(args.send).not.toHaveBeenCalled(); expect(args.authority.settle).not.toHaveBeenCalled();
  });
  it('fails closed on unavailable ICP permission/reservation', async () => {
    const args = setup(); args.authority.reserveNext.mockReset().mockRejectedValue(new Error('ICP denied'));
    await expect(deliverReservedNativePush(args.authority, args.send)).rejects.toThrow();
    expect(args.send).not.toHaveBeenCalled();
  });
  it.each(['web', 'supabase', 'another-account'])('refuses %s without any provider send', async bad => {
    const args = setup(); const reservation = row();
    if (bad === 'web') reservation.device.platform = 'web';
    else if (bad === 'supabase') reservation.payload.data.ignite_backend = 'supabase';
    else reservation.payload.data.recipient = bad;
    args.authority.reserveNext.mockReset().mockResolvedValueOnce(reservation).mockResolvedValue(undefined);
    expect(await deliverReservedNativePush(args.authority, args.send)).toMatchObject({ stopped: 1 });
    expect(args.send).not.toHaveBeenCalled();
  });
  it('settles an ambiguous send as held, without a second send', async () => {
    const args = setup(); args.send.mockRejectedValue(new Error('response lost'));
    expect(await deliverReservedNativePush(args.authority, args.send)).toMatchObject({ held: 1 });
    expect(args.send).toHaveBeenCalledTimes(1);
    expect(args.authority.settle).toHaveBeenCalledWith('icp-owned-attempt-1', { status: 'held' });
  });
  it('stops on lost settlement and never repeats the provider request or settlement', async () => {
    const args = setup(); args.authority.settle.mockRejectedValue(new Error('response lost'));
    await expect(deliverReservedNativePush(args.authority, args.send)).rejects.toThrow();
    expect(args.send).toHaveBeenCalledTimes(1); expect(args.authority.settle).toHaveBeenCalledTimes(1);
    expect(args.authority.reserveNext).toHaveBeenCalledTimes(1);
  });
  it('refuses an unconfirmed settlement instead of processing another device', async () => {
    const args = setup(); args.authority.settle.mockResolvedValue(false);
    await expect(deliverReservedNativePush(args.authority, args.send)).rejects.toThrow('do not replay');
    expect(args.authority.reserveNext).toHaveBeenCalledTimes(1);
  });
  it('returns a transient result to ICP without deciding retry time or retrying locally', async () => {
    const args = setup(); args.send.mockResolvedValue({ ok: false, status: 503, body: {} });
    expect(await deliverReservedNativePush(args.authority, args.send)).toMatchObject({ retry: 1 });
    expect(args.send).toHaveBeenCalledTimes(1);
    expect(args.authority.settle).toHaveBeenCalledWith('icp-owned-attempt-1', { status: 'retry', code: 'provider_transient' });
  });
  it('returns token-specific UNREGISTERED to ICP, never deletes tokens in Supabase', async () => {
    const args = setup(); args.send.mockResolvedValue({ ok: false, status: 404, body: { error: { details: [
      { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' },
    ] } } });
    expect(await deliverReservedNativePush(args.authority, args.send)).toMatchObject({ inactive: 1 });
    expect(args.authority.settle).toHaveBeenCalledWith('icp-owned-attempt-1', { status: 'inactive', code: 'unregistered' });
  });
  it('does not classify generic INVALID_ARGUMENT as a dead device', async () => {
    const args = setup(); args.send.mockResolvedValue({ ok: false, status: 400, body: { error: { status: 'INVALID_ARGUMENT' } } });
    expect(await deliverReservedNativePush(args.authority, args.send)).toMatchObject({ inactive: 0, stopped: 1 });
  });
  it('bounds a busy invocation, leaving further work on ICP', async () => {
    const args = setup(); args.authority.reserveNext.mockReset().mockResolvedValue(row());
    expect(await deliverReservedNativePush(args.authority, args.send, 2)).toMatchObject({ accepted: 2, complete: false });
    expect(args.authority.reserveNext).toHaveBeenCalledTimes(2);
  });
  it('integrates real transport validation with ICP settlement and only the linked gateway', async () => {
    const args = setup();
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'projects/test/messages/1' })));
    expect(await deliverReservedNativePush(args.authority, createDevFcmTransport(config, request))).toMatchObject({ accepted: 1 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain('connector-gateway.lovable.dev/firebase_messaging/');
  });
  it('uses a domain-separated deterministic TEST-only signing seed', async () => {
    const secret = 'synthetic-only-'.padEnd(64, 'x');
    const first = await nativeSenderSigningSeed(secret);
    expect(first).toHaveLength(32);
    expect(await nativeSenderSigningSeed(secret)).toEqual(first);
    expect(await nativeSenderSigningSeed(secret + 'different')).not.toEqual(first);
    await expect(nativeSenderSigningSeed('')).rejects.toThrow();
  });
});