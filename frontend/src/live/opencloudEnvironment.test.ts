import { afterEach, expect, it, vi } from 'vitest';
import { opencloudEnvironment, opencloudDerivationOrigin } from './opencloudEnvironment';
import { getActiveIcpTarget, registerIcpEngineResolver } from './targetRegistry';
import { applyIcpAdminOverrides } from './icpAdminOverrides';
import config from '../../../deploy/opencloud/dev.json';
afterEach(() => { vi.unstubAllEnvs(); applyIcpAdminOverrides(null); registerIcpEngineResolver(null); });
it('existing mainnet/email builds do not opt in implicitly', () => {
  vi.stubEnv('IGNITE_LIVE_OPENCLOUD_ENV', '');
  expect(opencloudEnvironment()).toBeNull(); expect(opencloudDerivationOrigin()).toBeUndefined();
});
it('engine identity is pinned to the new frontend, not the old DEV or PROD origin', () => {
  vi.stubEnv('IGNITE_LIVE_OPENCLOUD_ENV', 'opencloud-dev');
  vi.stubEnv('IGNITE_LIVE_OPENCLOUD_IDS_JSON', JSON.stringify({ frontend: 'h2knm-vaaaa-aaac5-aadqa-cai' }));
  vi.stubEnv('IGNITE_LIVE_II_DERIVATION_ORIGIN', 'https://h2knm-vaaaa-aaac5-aadqa-cai.icp.net');
  expect(opencloudDerivationOrigin()).toBe('https://h2knm-vaaaa-aaac5-aadqa-cai.icp.net');
  vi.stubEnv('IGNITE_LIVE_II_DERIVATION_ORIGIN', 'https://igniteclubhq.app');
  expect(() => opencloudDerivationOrigin()).toThrow(/bound/);
});
it('engine target ignores stored mainnet overrides and country resolver', () => {
  vi.stubEnv('IGNITE_LIVE_OPENCLOUD_ENV', 'opencloud-dev');
  const { frontend: _frontend, ...shared } = config.shared;
  const ids = { ...shared, ...config.groups[0].canisterIds };
  const full = { ...config.shared, ...Object.fromEntries(config.groups.flatMap(g => Object.entries(g.canisterIds).map(([name, id]) => [`${g.id}_${name}`, id]))) };
  vi.stubEnv('IGNITE_LIVE_OPENCLOUD_IDS_JSON', JSON.stringify(full));
  vi.stubEnv('IGNITE_LIVE_ICP_HOST', config.apiHost);
  const target = { provider: 'icp', alias: 'opencloud-dev', networkKind: 'cloud_engine', deploymentClass: 'cloud_engine',
    host: 'https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net', canisterIds: ids };
  vi.stubEnv('IGNITE_LIVE_ICP_TARGETS_JSON', JSON.stringify([target]));
  vi.stubEnv('IGNITE_LIVE_ACTIVE_ICP_ALIAS', 'opencloud-dev');
  applyIcpAdminOverrides({ canisterIds: { identity_access: 'old-mainnet-identity' } });
  registerIcpEngineResolver(() => ({ usable: true, alias: 'foreign', host: 'https://icp-api.io', canisterIds: { identity_access: 'foreign' } }));
  expect(getActiveIcpTarget().canisterIds.identity_access).toBe(ids.identity_access);
  expect(getActiveIcpTarget().host).toBe(target.host);
  vi.stubEnv('IGNITE_LIVE_ICP_TARGETS_JSON', JSON.stringify([{ ...target, canisterIds: {} }]));
  expect(() => getActiveIcpTarget()).toThrow(/Incomplete/);
});