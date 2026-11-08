import { describe, expect, it, vi } from 'vitest';
import { createDevFcmTransport } from '../../../supabase/functions/icp-dev-push-sender/fcm';
import { devPushPayload } from '../../../scripts/icp-dev-push-delivery.mjs';

const config = { supabaseUrl: 'https://ecsdwrarzfexssxtrymj.supabase.co', lovableKey: 'fixture-only', connectionKey: 'fixture-only' };
const device = { user: 'account-a', platform: 'android', token: 'fixture-token', active: true };
const payload = () => devPushPayload({ id: 'n-1', user: 'account-a', kind: 'message_chat', club: 'c-1', related_id: [], idempotency_key: 'm-1', body: 'private-text' });

describe('isolated Supabase-hosted DEV FCM transport', () => {
  it('refuses other Supabase projects and missing credentials before networking', () => {
    expect(() => createDevFcmTransport({ ...config, supabaseUrl: 'https://another-project.supabase.co' })).toThrow();
    expect(() => createDevFcmTransport({ ...config, connectionKey: '' })).toThrow();
  });
  it('sends one generic ICP envelope through the linked gateway only', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'projects/test/messages/1' })));
    expect(await createDevFcmTransport(config, request)(device, payload())).toEqual({ ok: true, status: 200 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('https://connector-gateway.lovable.dev/firebase_messaging/v1/projects/_/messages:send');
    const message = JSON.parse(request.mock.calls[0][1].body).message;
    expect(message.data.recipient).toBe('account-a');
    expect(message.data.ignite_backend).toBe('icp-dev');
    expect(JSON.stringify(message)).not.toContain('private-text');
  });
  it('refuses email mode and cross-account recipients without any send', async () => {
    const request = vi.fn(); const send = createDevFcmTransport(config, request);
    await expect(send(device, { ...payload(), data: { ...payload().data, ignite_backend: 'supabase' } })).rejects.toThrow();
    await expect(send({ ...device, user: 'account-b' }, payload())).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('refuses inactive devices, web tokens and private payload extras', async () => {
    const request = vi.fn(); const send = createDevFcmTransport(config, request);
    await expect(send({ ...device, active: false }, payload())).rejects.toThrow();
    await expect(send({ ...device, platform: 'web' }, payload())).rejects.toThrow();
    await expect(send(device, { ...payload(), data: { ...payload().data, private_body: 'private-text' } })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('preserves definite provider failure status and details without fallback', async () => {
    const body = { error: { status: 'UNAVAILABLE' } };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 503 }));
    const result = await createDevFcmTransport(config, request)(device, payload());
    expect(result).toMatchObject({ ok: false, status: 503, body });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('holds timeout and malformed acceptance rather than resending', async () => {
    const request = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(createDevFcmTransport(config, request)(device, payload())).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    const malformed = vi.fn().mockResolvedValue(new Response('<html>'));
    await expect(createDevFcmTransport(config, malformed)(device, payload())).rejects.toThrow();
    expect(malformed).toHaveBeenCalledTimes(1);
  });
});