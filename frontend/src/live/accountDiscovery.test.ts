import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
import { accountDiscoveryKey, readAccountDiscovery } from './accountDiscovery';
import { clearMembershipDiscovery, MEMBERSHIP_RECONCILE_MS } from './membershipDiscoveryCache';

const context = (principal = 'account', host = 'https://icp.example') => ({
  identity: { getPrincipal: () => ({ toText: () => principal }) },
  target: { alias: 'mainnet', host, networkKind: 'ic', canisterIds: { club_domain: 'club', mini_league_domain: 'league' } },
}) as unknown as FeatureBackendContext;
afterEach(() => { clearMembershipDiscovery(); vi.useRealTimers(); });
describe('independent account inventories', () => {
  it('shares league discovery across pages but keeps trash independent', async () => {
    vi.useFakeTimers();
    const ctx = context();
    const leagues = vi.fn(async () => ['league-1']);
    const trash = vi.fn(async () => ['removed-1']);
    await Promise.all([readAccountDiscovery(ctx, 'leagues', leagues), readAccountDiscovery(ctx, 'leagues', leagues)]);
    await readAccountDiscovery(ctx, 'trash', trash);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await readAccountDiscovery(ctx, 'leagues', leagues)).toEqual(['league-1']);
    expect(leagues).toHaveBeenCalledTimes(1);
    expect(trash).toHaveBeenCalledTimes(1);
    clearMembershipDiscovery();
    await readAccountDiscovery(ctx, 'leagues', leagues);
    expect(leagues).toHaveBeenCalledTimes(2);
  });
  it('isolates inventory/account/host and retains complete data after an overdue failed refresh', async () => {
    vi.useFakeTimers();
    const ctx = context();
    const load = vi.fn(async () => ['league-1']);
    await readAccountDiscovery(ctx, 'leagues', load);
    load.mockRejectedValue(new Error('Group unavailable'));
    vi.setSystemTime(Date.now() + MEMBERSHIP_RECONCILE_MS);
    expect(await readAccountDiscovery(ctx, 'leagues', load)).toEqual(['league-1']);
    await vi.advanceTimersByTimeAsync(0);
    expect(accountDiscoveryKey(ctx, 'leagues')).not.toBe(accountDiscoveryKey(ctx, 'trash'));
    expect(accountDiscoveryKey(ctx, 'leagues')).not.toBe(accountDiscoveryKey(context('other'), 'leagues'));
    expect(accountDiscoveryKey(ctx, 'leagues')).not.toBe(accountDiscoveryKey(context('account', 'https://other.example'), 'leagues'));
  });
});
describe('league discovery across groups', () => {
  it('keeps leagues from answering groups when one group refuses', async () => {
    vi.resetModules();
    const readAcross = vi.fn(async (_f: string, _d: string, _fn: unknown, merge: (p: { id: string }[][]) => unknown, requireComplete?: boolean) =>
      requireComplete ? Promise.reject(new Error('Account admission denied or unavailable')) : merge([[{ id: 'l1' }], [{ id: 'l1' }, { id: 'l2' }]]));
    vi.doMock('./groupDispatch', () => ({ clubDispatch: { readAcross } }));
    vi.doMock('./features/miniLeagues', () => ({ listMyLiveMiniLeagues: vi.fn() }));
    const { readDiscoveredMiniLeagues } = await import('./accountDiscovery');
    expect((await readDiscoveredMiniLeagues(context('partial'))).map((l: { id: string }) => l.id)).toEqual(['l1', 'l2']);
    expect(readAcross.mock.calls[0][4]).not.toBe(true);
  });
});
