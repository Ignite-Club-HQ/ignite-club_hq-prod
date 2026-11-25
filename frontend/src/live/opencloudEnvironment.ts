/** Explicit isolated artifact builds only. Never selected from branch/country or stored overrides. */
export function opencloudEnvironment(): 'opencloud-dev' | 'opencloud-prod' | null {
  const value = import.meta.env.IGNITE_LIVE_OPENCLOUD_ENV;
  if (!value) return null;
  if (value !== 'opencloud-dev' && value !== 'opencloud-prod') throw new Error('Unknown OpenCloud environment');
  return value;
}

export function opencloudDerivationOrigin(): string | undefined {
  if (!opencloudEnvironment()) return undefined;
  const ids = JSON.parse(import.meta.env.IGNITE_LIVE_OPENCLOUD_IDS_JSON || '{}') as Record<string, string>;
  const origin = import.meta.env.IGNITE_LIVE_II_DERIVATION_ORIGIN;
  if (!ids.frontend || origin !== `https://${ids.frontend}.icp.net`) throw new Error('OpenCloud sign-in origin is not bound to its frontend');
  return origin;
}

export function opencloudPinnedTarget(): { host: string; canisterIds: Record<string, string> } | null {
  if (!opencloudEnvironment()) return null;
  const full = JSON.parse(import.meta.env.IGNITE_LIVE_OPENCLOUD_IDS_JSON || '{}') as Record<string, string>;
  const shared = ['identity_access', 'placement_registry', 'shard_router', 'migration_coordinator', 'secret_workload_identity'];
  const services = ['club_domain', 'club_points_domain', 'competition_domain', 'events_domain', 'insights_domain', 'media_blob_store',
    'media_metadata', 'messaging_domain', 'mini_league_domain', 'notification_queue', 'pii_access_control', 'timer_jobs', 'vault_domain'];
  const names = ['frontend', ...shared, ...['g1', 'g2'].flatMap(group => services.map(service => `${group}_${service}`))];
  if (Object.keys(full).length !== 32 || names.some(name => !full[name]) || new Set(Object.values(full)).size !== 32) {
    throw new Error('Complete isolated OpenCloud inventory required');
  }
  const host = import.meta.env.IGNITE_LIVE_ICP_HOST;
  if (!host || !host.startsWith('https://') || new URL(host).origin !== host || new URL(host).hostname === 'icp-api.io') {
    throw new Error('Explicit isolated engine HTTPS host required');
  }
  return { host, canisterIds: Object.fromEntries([...shared.map(name => [name, full[name]]),
    ...services.map(name => [name, full[`g1_${name}`]])]) };
}
/** OpenCloud builds accept router-returned group services only from their own pinned inventory:
 * router group "base" maps to g1_*, "g2" to g2_*; shared services keep their shared ID. */
export function assertOpenCloudGroupCanister(groupId: string, domain: string, canisterId: string): void {
  if (!opencloudEnvironment()) return;
  const full = JSON.parse(import.meta.env.IGNITE_LIVE_OPENCLOUD_IDS_JSON || '{}') as Record<string, string>;
  const prefix = groupId === 'base' ? 'g1' : groupId === 'g2' ? 'g2' : null;
  const expected = full[domain] ?? (prefix ? full[`${prefix}_${domain}`] : undefined);
  if (!expected || expected !== canisterId) throw new Error('Club group is outside the OpenCloud inventory');
}
