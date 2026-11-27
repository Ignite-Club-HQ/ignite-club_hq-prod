import { getActiveIcpTarget, type IcpTargetConfig } from './targetRegistry';
import { opencloudEnvironment, opencloudPinnedTarget } from './opencloudEnvironment';
import { buildGroupSpecs, type GroupSpec } from './groupUtilization';
import { ROUTING_GATES_SNAPSHOT } from './generated/routingGates';
import { GROUP_TESTED_LIMITS } from './groupTestedLimits';

/** Monitoring inventory only. Never grants routing, admission or write authority. */
export function getAdminCanisterTracking(): {
  target: IcpTargetConfig; engine: boolean; groups: GroupSpec[];
  globalCanisters: { key: string; canisterId: string }[];
  frontendId: string | undefined; cacheKey: string;
} {
  const target = getActiveIcpTarget();
  const engine = !!opencloudEnvironment();
  if (engine) {
    opencloudPinnedTarget(); // Reject partial or foreign inventories before any probe.
    const ids = JSON.parse(import.meta.env.IGNITE_LIVE_OPENCLOUD_IDS_JSON || '{}') as Record<string, string>;
    const groups: GroupSpec[] = ['g1', 'g2'].map((id, index) => ({
      id, label: `Group ${index + 1}`, accepting: null, maxClubs: null,
      canisters: Object.entries(ids).filter(([key]) => key.startsWith(`${id}_`))
        .map(([key, canisterId]) => ({ key: key.slice(3), canisterId })),
      photoStoreId: ids[`${id}_media_blob_store`] ?? null,
      testedLimitBytes: {}, // Mainnet load-test evidence does not apply to an engine.
    }));
    return { target: { ...target, canisterIds: ids }, engine, groups,
      globalCanisters: Object.entries(ids).filter(([key]) => key !== 'frontend' && !/^g[12]_/.test(key))
        .map(([key, canisterId]) => ({ key, canisterId })), frontendId: ids.frontend,
      cacheKey: JSON.stringify([target.host, ids]),
    };
  }
  const snapshot = ROUTING_GATES_SNAPSHOT?.host === target.host &&
    ROUTING_GATES_SNAPSHOT?.routerCanisterId === target.canisterIds.shard_router ? ROUTING_GATES_SNAPSHOT : null;
  const frontendId = target.canisterIds.frontend ?? target.canisterIds.internet_identity_frontend;
  const { frontend: _frontend, internet_identity_frontend: _ii, ...backendIds } = target.canisterIds;
  const inventory = buildGroupSpecs({ snapshot, sharedCanisterIds: backendIds, testedLimits: GROUP_TESTED_LIMITS });
  const ids = Object.fromEntries([...inventory.globalCanisters, ...inventory.groups.flatMap(g =>
    g.canisters.map(c => ({ ...c, key: `${g.id}_${c.key}` })))].map(c => [c.key, c.canisterId]));
  return { target: { ...target, canisterIds: { ...ids, ...(frontendId ? { frontend: frontendId } : {}) } },
    engine, ...inventory, frontendId, cacheKey: JSON.stringify([target.host, ids, frontendId]) };
}