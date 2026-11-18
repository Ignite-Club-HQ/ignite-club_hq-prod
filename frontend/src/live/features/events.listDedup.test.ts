import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from '../featureRouter';
const mocks = vi.hoisted(() => ({ list: vi.fn(), connect: vi.fn() }));
vi.mock('../domains', () => ({ connectLiveEventsDomain: mocks.connect }));
vi.mock('./vault', () => ({ grantLiveClubPiiRead: vi.fn(), registerLivePiiText: vi.fn(), resolveLivePiiTextBatch: vi.fn() }));
vi.mock('../groupDispatch', () => ({ clubDispatch: { remember: vi.fn() } }));
import { listLiveEvents } from './events';
const identity = { getPrincipal: () => ({ toText: () => 'caller' }) };
const ctx = { identity, target: { host: 'https://dev.invalid', canisterIds: { events_domain: 'events' } } } as unknown as FeatureBackendContext;
const row = { id: 'event-1', club_id: 'club', title: 'Training', team_id: [] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({ actor: { list_events: mocks.list } });
  mocks.list.mockResolvedValue([row]);
});
describe('schedule event read deduplication', () => {
  it('joins overlapping reads beyond the batching tick but rereads after settlement', async () => {
    let finish: ((value: unknown[]) => void) | undefined;
    mocks.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = listLiveEvents(ctx, 'club', 'team');
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledOnce());
    const second = listLiveEvents({ ...ctx }, 'club', 'team');
    finish?.([row]);
    const [a, b] = await Promise.all([first, second]);
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(a).toEqual(b); expect(a).not.toBe(b);
    await listLiveEvents(ctx, 'club', 'team');
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it('keeps accounts, full destinations and filters separate', async () => {
    await Promise.all([
      listLiveEvents(ctx, 'club', 'team'),
      listLiveEvents({ ...ctx, identity: { ...identity } } as FeatureBackendContext, 'club', 'team'),
      listLiveEvents({ ...ctx, target: { ...ctx.target, host: 'https://other.invalid' } }, 'club', 'team'),
      listLiveEvents({ ...ctx, target: { ...ctx.target, canisterIds: { events_domain: 'other' } } }, 'club', 'team'),
      listLiveEvents(ctx, 'club', 'other-team'),
    ]);
    expect(mocks.list).toHaveBeenCalledTimes(5);
  });
  it('removes repeated exact event rows, never same-title events or another club', async () => {
    mocks.list.mockResolvedValue([row, row, { ...row, id: 'event-2' }, { ...row, club_id: 'other-club' }]);
    const rows = await listLiveEvents(ctx, 'club', 'team');
    expect(rows.map(value => [value.club_id, value.id])).toEqual([
      ['club', 'event-1'], ['club', 'event-2'], ['other-club', 'event-1'],
    ]);
  });
  it('propagates shared failure and releases it for a fresh authorized read', async () => {
    mocks.list.mockRejectedValueOnce(new Error('Access denied'));
    const failed = await Promise.allSettled([listLiveEvents(ctx, 'club', 'team'), listLiveEvents(ctx, 'club', 'team')]);
    expect(failed.map(value => value.status)).toEqual(['rejected', 'rejected']);
    expect(mocks.list).toHaveBeenCalledOnce();
    await expect(listLiveEvents(ctx, 'club', 'team')).resolves.toEqual([row]);
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
});