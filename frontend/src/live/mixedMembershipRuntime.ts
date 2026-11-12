import type { ClubScope, FeatureBackendContext } from './featureRouter';
import type { GroupDomain } from './groupRouting';
import type { MixedMembershipSession } from './mixedMembershipSession';
import { CLOUD_ENGINE_RELEASED } from './enginePreparation';
import { isScopedContext } from './scopedContext';

type Runtime = {
  session: MixedMembershipSession;
  /** Authorized destination read; absence only, never permission inference. */
  locate: (ctx: FeatureBackendContext, scope: ClubScope) => Promise<string | null>;
};
let runtime: Runtime | null = null;

/** No configuration checkbox can activate an unaccepted engine deployment. */
export function installMixedMembershipRuntime(value: Runtime): void {
  const local = typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!CLOUD_ENGINE_RELEASED && !local) throw new Error('Cloud Engine acceptance is still pending');
  value.session.assertCurrent();
  if (runtime?.session === value.session) { runtime = value; return; }
  clearMixedMembershipRuntime(); runtime = value;
}
export function clearMixedMembershipRuntime(): void { runtime?.session.dispose(); runtime = null; }
export function currentMixedMembershipSession(ctx: FeatureBackendContext): MixedMembershipSession | null {
  if (!runtime || isScopedContext(ctx)) return null;
  runtime.session.assertCurrent();
  if (ctx.identity.getPrincipal().toText() !== runtime.session.principal) {
    clearMixedMembershipRuntime(); throw new Error('Mixed membership account changed');
  }
  // The shared context is not necessarily itself a group context.
  if (ctx.target.canisterIds.identity_access !== runtime.session.shared.target.canisterIds.identity_access) {
    clearMixedMembershipRuntime(); throw new Error('Shared account authority changed');
  }
  return runtime.session;
}

export async function dispatchMixedMembership<T>(
  ctx: FeatureBackendContext, domain: GroupDomain | null, scope: ClubScope | undefined,
  read: (context: FeatureBackendContext) => Promise<T>,
): Promise<{ value: T } | null> {
  const session = currentMixedMembershipSession(ctx);
  if (!session || scope?.legacy) return null;
  if (scope && 'shared' in scope || !domain) {
    const value = await read(session.shared); session.assertCurrent(); return { value };
  }
  if (!scope) throw new Error('Mixed membership requires a club scope');
  if ('newClubId' in scope || 'inviteToken' in scope) throw new Error('Engine admission and invite handover are not released');
  if ('everyGroup' in scope || 'memberGroups' in scope) {
    if (scope.writeKey) throw new Error('Writes must name one club');
    const parts = 'memberGroups' in scope ? await session.readMembers(domain, read) : await session.readEverywhere(domain, read);
    return { value: scope.merge(parts) as T };
  }
  let club: string;
  if ('clubId' in scope) club = scope.clubId;
  else {
    const current = runtime;
    if (!current) throw new Error('Mixed membership session unavailable');
    const claims = await session.readEverywhere(domain, context => current.locate(context, scope));
    const hits = claims.filter((id): id is string => id !== null);
    if (hits.length !== 1) throw new Error('Resource missing, unauthorized or claimed by multiple destinations');
    club = hits[0];
  }
  const value = scope.writeKey
    ? await session.writeClub(club, domain, scope.writeKey, read)
    : await session.readClub(club, domain, read);
  return { value };
}