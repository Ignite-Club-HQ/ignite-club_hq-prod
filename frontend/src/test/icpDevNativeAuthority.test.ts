import { describe, expect, it, vi } from 'vitest';
import { createNativeQueueAuthority } from '../../../supabase/functions/icp-dev-push-sender/authority';
const row = { receipt: 'r-1', user: 'user-1', token: 'fake-token', platform: 'android', notification_id: 'n-1', kind: 'message_chat', related_id: ['chat-1'], scope: 'chat-1', key: 'message-1' };
describe('ICP native reservation adapter', () => {
  it('derives recipient and token only from an authorized reservation', async () => {
    const actor = { reserve_native_push: vi.fn().mockResolvedValue({ Ok: [row] }), settle_native_push: vi.fn() };
    const result = await createNativeQueueAuthority(actor).reserveNext();
    expect(result?.device.user).toBe('user-1'); expect(result?.device.token).toBe('fake-token');
    expect(result?.payload.data.url).toBe('/messages?conversation=chat-1&message=message-1');
  });
  it('fails closed on older or refusing canisters', async () => {
    const actor = { reserve_native_push: vi.fn().mockResolvedValue({ Err: 'refused' }), settle_native_push: vi.fn() };
    await expect(createNativeQueueAuthority(actor).reserveNext()).rejects.toThrow();
    expect(actor.settle_native_push).not.toHaveBeenCalled();
  });
  it('holds transient failures on ICP until an ICP retry policy exists', async () => {
    const actor = { reserve_native_push: vi.fn(), settle_native_push: vi.fn().mockResolvedValue({ Ok: null }) };
    expect(await createNativeQueueAuthority(actor).settle('r-1', { status: 'retry', code: 'provider_transient' })).toBe(true);
    expect(actor.settle_native_push).toHaveBeenCalledExactlyOnceWith('r-1', 'held');
  });
});