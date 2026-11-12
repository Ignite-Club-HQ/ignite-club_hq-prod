/** Compose verified single-deployment sessions; location never grants access. */
import type { FeatureBackendContext } from './featureRouter';
import type { GroupDomain } from './groupRouting';
import { GROUP_DOMAINS } from './groupRouting';
import { openGroupSession, type GroupSessionTransport } from './groupSession';
import { markScopedContext } from './scopedContext';

export type MembershipDestination = {
  context: FeatureBackendContext;
  transport: GroupSessionTransport;
};

export function membershipDestinationKey(context: FeatureBackendContext): string {
  return JSON.stringify([context.identity.getPrincipal().toText(), context.target.alias,
    context.target.host, context.target.networkKind,
    Object.entries(context.target.canisterIds).sort(([a], [b]) => a.localeCompare(b))]);
}

export async function openMixedMembershipSession(
  shared: FeatureBackendContext,
  destinations: readonly MembershipDestination[],
) {
  const principal = shared.identity.getPrincipal().toText();
  if (!principal || principal === '2vxsx-fae' || destinations.length < 1 || destinations.length > 16) {
    throw new Error('Authenticated bounded membership inventory required');
  }
  const keys = new Set<string>();
  const authorities = new Set<string>();
  const sharedIdentity = shared.target.canisterIds.identity_access;
  if (!sharedIdentity) throw new Error('Shared account authority required');
  for (const { context } of destinations) {
    const target = context.target;
    const host = new URL(target.host);
    if (context.identity.getPrincipal().toText() !== principal || target.status !== 'active' ||
        host.protocol !== 'https:' || host.username || host.password || host.pathname !== '/' || host.search || host.hash ||
        !['public_mainnet', 'cloud_engine'].includes(target.networkKind) ||
        target.deploymentClass !== (target.networkKind === 'cloud_engine' ? 'cloud_engine' : 'public_subnet') ||
        target.canisterIds.identity_access !== sharedIdentity || !target.canisterIds.club_domain || !target.canisterIds.shard_router) {
      throw new Error('Membership destination does not match the shared account and deployment');
    }
    const key = membershipDestinationKey(context);
    if (keys.has(key) || authorities.has(target.canisterIds.club_domain)) throw new Error('Duplicate membership destination');
    keys.add(key); authorities.add(target.canisterIds.club_domain);
  }
  let disposed = false;
  const live = () => {
    if (disposed || shared.identity.getPrincipal().toText() !== principal || destinations.some(d => d.context.identity.getPrincipal().toText() !== principal)) {
      throw new Error('Mixed membership account changed or session disposed');
    }
  };
  // Settle every opener so a late success cannot leak a session after failure.
  const results = await Promise.allSettled(destinations.map(async destination => ({
    ...destination, session: await openGroupSession(destination.context, destination.transport),
  })));
  const legs = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
  const dispose = () => { disposed = true; for (const leg of legs) leg.session.dispose(); };
  const failure = results.find(r => r.status === 'rejected');
  if (failure?.status === 'rejected') { dispose(); throw failure.reason; }
  const clubs = new Map<string, typeof legs[number]>();
  try {
    live();
    for (const leg of legs) for (const club of leg.session.memberClubIds) {
      if (clubs.has(club)) throw new Error('Club claimed by multiple destinations');
      clubs.set(club, leg);
      if (clubs.size > 1000) throw new Error('Mixed membership exceeds club budget');
    }
  } catch (error) { dispose(); throw error; }
  const domainCheck = (domain: GroupDomain) => { live(); if (!GROUP_DOMAINS.includes(domain)) throw new Error('Unknown club domain'); };
  const owner = (club: string) => {
    live(); const leg = clubs.get(club);
    if (!leg) throw new Error('Club outside discovered membership');
    return leg;
  };
  const readClub = async <T>(club: string, domain: GroupDomain, read: (context: FeatureBackendContext) => Promise<T>): Promise<T> => {
    domainCheck(domain); const leg = owner(club);
    const run = (ctx: FeatureBackendContext) => read(markScopedContext(ctx));
    const result = leg.session.isAssigned(club)
      ? await leg.session.readClub(club, domain, run)
      : await leg.session.readMemberGroups(domain, async ctx => [await run(ctx)]).then(parts => {
        if (parts.length !== 1) throw new Error('Legacy membership has ambiguous destinations');
        return parts[0];
      });
    live(); return result;
  };
  return {
    principal, shared, memberClubIds: [...clubs.keys()].sort(), dispose,
    assertCurrent: live,
    ownsContext: (ctx: FeatureBackendContext) => keys.has(membershipDestinationKey(ctx)),
    readClub,
    async writeClub<T>(club: string, domain: GroupDomain, key: string, write: (context: FeatureBackendContext) => Promise<T>): Promise<T> {
      domainCheck(domain); const leg = owner(club);
      if (!key || key.length > 128) throw new Error('Write key required');
      // Always one attempt: a lost engine reply must never replay on mainnet.
      const result = leg.session.isAssigned(club)
        ? await leg.session.writeClub(club, domain, key, ctx => write(markScopedContext(ctx)), 1)
        : await readClub(club, domain, write);
      live(); return result;
    },
    async readMembers<T>(domain: GroupDomain, read: (context: FeatureBackendContext) => Promise<T>): Promise<T[]> {
      domainCheck(domain);
      const parts = await Promise.all(legs.map(leg => leg.session.readMemberGroups(domain, async ctx => [await read(markScopedContext(ctx))])));
      live(); return parts.flat();
    },
    async readEverywhere<T>(domain: GroupDomain, read: (context: FeatureBackendContext) => Promise<T>): Promise<T[]> {
      domainCheck(domain);
      const parts = await Promise.all(legs.map(async leg => {
        const grouped = await leg.session.readEveryGroup(domain, async ctx => [await read(markScopedContext(ctx))]);
        if (leg.session.memberClubIds.some(club => leg.session.isLegacyMember(club))) grouped.push(await read(markScopedContext(leg.context)));
        return grouped;
      }));
      live(); return parts.flat();
    },
  };
}

export type MixedMembershipSession = Awaited<ReturnType<typeof openMixedMembershipSession>>;