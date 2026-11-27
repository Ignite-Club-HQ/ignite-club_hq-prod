import { afterEach, expect, it, vi } from 'vitest';
import { getAdminCanisterTracking } from './adminCanisterTracking';
import { applyIcpAdminOverrides } from './icpAdminOverrides';
import dev from '../../../deploy/opencloud/dev.json';
import prod from '../../../deploy/opencloud/prod.json';

afterEach(() => { vi.unstubAllEnvs(); applyIcpAdminOverrides(null); });
function select(config: typeof dev | typeof prod) {
  const { frontend: _frontend, ...shared } = config.shared;
  const full = { ...config.shared, ...Object.fromEntries(config.groups.flatMap(g =>
    Object.entries(g.canisterIds).map(([key, id]) => [`${g.id}_${key}`, id]))) };
  vi.stubEnv('IGNITE_LIVE_OPENCLOUD_ENV', config.environment);
  vi.stubEnv('IGNITE_LIVE_OPENCLOUD_IDS_JSON', JSON.stringify(full));
  vi.stubEnv('IGNITE_LIVE_ICP_HOST', config.apiHost);
  vi.stubEnv('IGNITE_LIVE_ACTIVE_ICP_ALIAS', config.environment);
  vi.stubEnv('IGNITE_LIVE_ICP_TARGETS_JSON', JSON.stringify([{
    provider: 'icp', alias: config.environment, networkKind: 'cloud_engine', deploymentClass: 'cloud_engine',
    host: config.apiHost, canisterIds: { ...shared, ...config.groups[0].canisterIds },
  }]));
  return full;
}
for (const config of [dev, prod]) {
  it(`${config.environment} tracks exactly its 32 allocated canisters on its engine host`, () => {
    const full = select(config);
    applyIcpAdminOverrides({ canisterIds: { club_domain: 'proe7-kqaaa-aaaas-qg6gq-cai' } });
    const tracking = getAdminCanisterTracking();
    expect(tracking.target.host).toBe(config.apiHost);
    expect(tracking.target.canisterIds).toEqual(full);
    expect(new Set(Object.values(tracking.target.canisterIds)).size).toBe(32);
    expect(tracking.frontendId).toBe(config.shared.frontend);
    expect(tracking.globalCanisters).toHaveLength(5);
    expect(tracking.groups).toHaveLength(2);
    for (const [i, group] of tracking.groups.entries()) {
      expect(group.canisters).toHaveLength(13);
      expect(Object.fromEntries(group.canisters.map(c => [c.key, c.canisterId]))).toEqual(config.groups[i].canisterIds);
      expect(group.photoStoreId).toBe(config.groups[i].canisterIds.media_blob_store);
      expect(group.accepting).toBeNull();
      expect(group.testedLimitBytes).toEqual({});
    }
    expect(tracking.engine).toBe(true);
  });
}
it('partial inventory refuses tracking rather than probing mainnet or omitting group two', () => {
  const full = select(dev);
  delete (full as Record<string, string>).g2_events_domain;
  vi.stubEnv('IGNITE_LIVE_OPENCLOUD_IDS_JSON', JSON.stringify(full));
  expect(() => getAdminCanisterTracking()).toThrow(/inventory/);
});
it('switching environments changes the monitoring cache identity', () => {
  select(dev); const devKey = getAdminCanisterTracking().cacheKey;
  select(prod); expect(getAdminCanisterTracking().cacheKey).not.toBe(devKey);
});