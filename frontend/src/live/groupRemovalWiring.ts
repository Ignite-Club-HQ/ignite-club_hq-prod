/** Opening proof that removals are enforced in every registered group.
 * Read by the controlling operator from each canister's own settings (the
 * management canister reports environment variables only to controllers),
 * never from local records or frontend flags. Services decide account
 * admission from these settings; with admission off they admit everyone. */
import type { GroupDescriptor, GroupDomain } from './groupRouting';

/** Group services that check account admission (timer_jobs and the global workload identity do not). */
export const ADMISSION_DOMAINS: readonly GroupDomain[] = [
  'club_domain', 'events_domain', 'messaging_domain', 'vault_domain', 'competition_domain', 'club_points_domain',
  'mini_league_domain', 'media_metadata', 'insights_domain', 'notification_queue', 'pii_access_control',
];
export const ADMISSION_FLAG = 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL';
export const ADMISSION_AUTHORITY = 'IGNITE_ACCOUNT_SERVICE_IDENTITY';
/** PROD's commissioned member-access switch; equivalent to the DEV flag for removal checks. */
export const ADMISSION_RELEASE_FLAG = 'IGNITE_ACCOUNT_ADMISSION_RELEASE';

export const REMOVAL_RELEASE_FLAG = 'IGNITE_ACCOUNT_REMOVAL_RELEASE';

/** Member-switch change for one service. PROD must use the commissioned
 * release switch and clear the local rehearsal switch (services treat
 * rehearsal plus release as an invalid mode, and rehearsal alone enables
 * removal). DEV keeps its rehearsal switch. Refuses where global removal is
 * already released, because ordinary access needs separate review there. */
export function admissionSwitchPatch(rows: { name: string; value: string }[], production: boolean):
  { set: Record<string, string>; remove: string[] } {
  if (!production) return { set: { [ADMISSION_FLAG]: '1' }, remove: [] };
  if (rows.some(r => r.name === REMOVAL_RELEASE_FLAG && r.value === '1'))
    throw new Error('Global account removal is already released on this service; stop and review');
  return { set: { [ADMISSION_RELEASE_FLAG]: '1' }, remove: [ADMISSION_FLAG] };
}

/** Merges a patch over the full current list (environment settings replace-all). */
export function mergeEnvironment(rows: { name: string; value: string }[], set: Record<string, string>, remove: string[] = []) {
  const map = new Map(rows.map(e => [e.name, e.value]));
  for (const k of remove) map.delete(k);
  for (const [k, v] of Object.entries(set)) map.set(k, v);
  return [...map].map(([name, value]) => ({ name, value }));
}

/** True when the service carries exactly the switch admissionSwitchPatch writes. */
export function admissionSwitchApplied(rows: { name: string; value: string }[], production: boolean): boolean {
  const get = (k: string) => rows.find(r => r.name === k)?.value;
  return production ? get(ADMISSION_RELEASE_FLAG) === '1' && get(ADMISSION_FLAG) === undefined : get(ADMISSION_FLAG) === '1';
}

export type RemovalWiringEvidence = { revision: bigint; groupIds: string[]; checkedAtMs: number };
export type SettingsReader = (canisterId: string) => Promise<{ name: string; value: string }[]>;

export async function verifyRemovalWiring(registry: { revision: bigint; groups: GroupDescriptor[] }, identityAccess: string,
  read: SettingsReader, nowMs: number): Promise<{ evidence: RemovalWiringEvidence | null; problems: string[] }> {
  const problems: string[] = [];
  if (registry.groups.length === 0) problems.push('no registered groups');
  for (const g of registry.groups) {
    const targets: [string, string | undefined][] = ADMISSION_DOMAINS.map(d => [d, g.domains.find(x => x.domain === d)?.canisterId]);
    targets.push(['photo store', g.photoStore]);
    for (const [name, id] of targets) {
      if (!id) { problems.push(`${g.id}: ${name} missing`); continue; }
      let env: { name: string; value: string }[];
      try { env = await read(id); } catch (e) { problems.push(`${g.id}: ${name} settings unreadable (${e instanceof Error ? e.message : e})`); continue; }
      const get = (k: string) => { const hits = env.filter(v => v.name === k); return hits.length === 1 ? hits[0].value : undefined; };
      if (get(ADMISSION_FLAG) === '1' && get(ADMISSION_RELEASE_FLAG) === '1') problems.push(`${g.id}: ${name} has conflicting member switches`);
      else if (get(ADMISSION_FLAG) !== '1' && get(ADMISSION_RELEASE_FLAG) !== '1') problems.push(`${g.id}: ${name} removal checks off`);
      if (get(ADMISSION_AUTHORITY) !== identityAccess) problems.push(`${g.id}: ${name} not bound to the account service`);
    }
  }
  return problems.length ? { evidence: null, problems }
    : { evidence: { revision: registry.revision, groupIds: registry.groups.map(g => g.id), checkedAtMs: nowMs }, problems };
}
