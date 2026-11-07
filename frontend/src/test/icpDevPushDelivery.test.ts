import { describe, expect, it, vi } from 'vitest';
import { classifyDevFcmFailure, deliverDevPush, devPushPayload } from '../../../scripts/icp-dev-push-delivery.mjs';

const notification = { id: 'n-1', user: 'account-a', kind: 'message_chat', club: 'conversation-1', related_id: [], idempotency_key: 'm-1', body: 'PRIVATE MESSAGE MUST NOT LEAVE ICP' };
const devices = ['one', 'two'].map(installationId => ({ user: 'account-a', installationId, generation: 1, platform: 'android', active: true }));
function setup() {
  const records = new Map();
  return { queueId: 'test-queue', notification, devices, authorize: vi.fn().mockResolvedValue(true),
    send: vi.fn().mockResolvedValue({ ok: true }), deactivate: vi.fn(), now: () => 1000,
    journal: { read: vi.fn(async key => records.get(JSON.stringify(key))), write: vi.fn(async (key, value) => { records.set(JSON.stringify(key), value); }) },
  };
}
describe('isolated DEV per-device delivery core', () => {
  it('never exposes message content and emits only an ICP account-bound tap envelope', () => {
    const payload = devPushPayload(notification);
    expect(JSON.stringify(payload)).not.toContain(notification.body);
    expect(payload.data.recipient).toBe('account-a'); expect(payload.data.ignite_backend).toBe('icp-dev');
    expect(payload.data.url).toBe('/messages?conversation=conversation-1&message=m-1');
  });
  it('retains partial-device retries without repeating already accepted devices', async () => {
    const args = setup(); args.send.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, status: 503 });
    expect(await deliverDevPush(args)).toMatchObject({ accepted: 1, retry: 1, complete: false });
    args.now = () => 121001;
    expect(await deliverDevPush(args)).toMatchObject({ accepted: 1, complete: true });
    expect(args.send).toHaveBeenCalledTimes(3);
    expect(args.send.mock.calls[2][0].installationId).toBe('two');
  });
  it('does not send after membership, mute, preference or device authorization denies', async () => {
    const args = setup(); args.authorize.mockResolvedValue(false);
    expect(await deliverDevPush(args)).toMatchObject({ denied: 2, complete: false });
    expect(args.send).not.toHaveBeenCalled();
  });
  it('holds an ambiguous FCM send rather than automatically replaying it', async () => {
    const args = setup(); args.send.mockRejectedValue(new Error('connection lost'));
    expect(await deliverDevPush(args)).toMatchObject({ held: 2, complete: false });
    await deliverDevPush(args); expect(args.send).toHaveBeenCalledTimes(2);
  });
  it('deactivates UNREGISTERED only, never generic 404 or INVALID_ARGUMENT', () => {
    expect(classifyDevFcmFailure(404, { error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } })).toMatchObject({ action: 'deactivate' });
    expect(classifyDevFcmFailure(404, {})).toMatchObject({ action: 'stop' });
    expect(classifyDevFcmFailure(400, { error: { status: 'INVALID_ARGUMENT' } })).toMatchObject({ action: 'stop' });
  });
  it('stops after five acknowledged transient failures', async () => {
    const args = setup(); args.devices = [devices[0]]; args.send.mockResolvedValue({ ok: false, status: 429 });
    let now = 1000; args.now = () => now;
    for (let i = 0; i < 6; i++) { await deliverDevPush(args); now += 1800001; }
    expect(args.send).toHaveBeenCalledTimes(5);
  });
});