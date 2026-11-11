import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ mode: 'icp', target: { host: 'https://icp-api.io', canisterIds: {} as Record<string, string> } }));
vi.mock('./authBackendMode', () => ({ resolveAuthBackend: () => state.mode }));
vi.mock('./targetRegistry', () => ({ getActiveIcpTarget: () => state.target }));
import { DEV_PUSH_IDENTITY, DEV_PUSH_QUEUE, isDevIcpPushTarget, usesDevIcpPush } from './icpPushMode';

describe('DEV ICP push boundary', () => {
  beforeEach(() => { state.mode = 'icp'; state.target = { host: 'https://icp-api.io', canisterIds: { identity_access: DEV_PUSH_IDENTITY, notification_queue: DEV_PUSH_QUEUE } }; });
  it('allows only the explicit DEV identity and device directory together', () => { expect(usesDevIcpPush()).toBe(true); });
  it('never selects ICP push for email/Supabase mode', () => { state.mode = 'supabase'; expect(usesDevIcpPush()).toBe(false); });
  it('allows the exact LIVE pair so open-app alerts run on the live app', () => {
    state.target.canisterIds.notification_queue = 'w263o-3aaaa-aaaai-ayesq-cai'; state.target.canisterIds.identity_access = 'wb3hl-byaaa-aaaai-ayeqa-cai'; expect(usesDevIcpPush()).toBe(true);
  });
  it('rejects mixed DEV/PROD pairs', () => {
    state.target.canisterIds.notification_queue = 'w263o-3aaaa-aaaai-ayesq-cai'; expect(usesDevIcpPush()).toBe(false);
    state.target.canisterIds.notification_queue = DEV_PUSH_QUEUE; state.target.canisterIds.identity_access = 'other'; expect(usesDevIcpPush()).toBe(false);
  });
  it('rejects cloud engines and alternate hosts rather than falling back', () => {
    expect(isDevIcpPushTarget({ ...state.target, host: 'https://engine.example' })).toBe(false);
  });
});
import { groupPushQueues as __groupPushQueues } from './icpPushMode';
describe('second member group alert registration', () => {
  it('LIVE phones also register on the second group queue; TEST does not', () => {
    expect(__groupPushQueues({ canisterIds: { notification_queue: 'w263o-3aaaa-aaaai-ayesq-cai' } })).toEqual(['zu4gk-vqaaa-aaaal-qxp5a-cai']);
    expect(__groupPushQueues({ canisterIds: { notification_queue: 'jfcdq-yiaaa-aaaal-qxloa-cai' } })).toEqual([]);
  });
});
