import type { FeatureBackendContext, ClubScope } from './featureRouter';
import type { IcpTargetConfig } from './targetRegistry';
import { CLOUD_ENGINE_RELEASED } from './enginePreparation';
import { openMixedMembershipSession } from './mixedMembershipSession';
import { installMixedMembershipRuntime } from './mixedMembershipRuntime';

/** Explicit commissioning entry point, not country-based routing or admission. */
export async function openLiveMixedMembership(
  shared: FeatureBackendContext, approvedDestinations: readonly { target: IcpTargetConfig; deploymentAlias: string }[],
): Promise<void> {
  if (!CLOUD_ENGINE_RELEASED) throw new Error('Real-engine membership acceptance is still pending');
  const { createLiveGroupSessionTransport, lookupEntityClub } = await import('./groupSessionLive');
  const destinations = await Promise.all(approvedDestinations.map(async ({ target, deploymentAlias }) => {
    if (!deploymentAlias) throw new Error('Exact destination deployment alias required');
    const context = { identity: shared.identity, target };
    return { context, transport: await createLiveGroupSessionTransport(context, undefined, deploymentAlias) };
  }));
  const session = await openMixedMembershipSession(shared, destinations);
  try {
    installMixedMembershipRuntime({ session, locate: async (ctx, scope: ClubScope) => {
      const entries: Record<string, Parameters<typeof lookupEntityClub>[1]> = {
        conversationId: 'conversation', teamId: 'team', eventId: 'event', photoId: 'photo',
        galleryCardId: 'galleryCard', newsId: 'news', competitionId: 'competition',
        competitionMatchId: 'competitionMatch', eoiId: 'eoi', seasonId: 'season',
        vaultFileId: 'vaultFile', vaultFolderId: 'vaultFolder', notificationId: 'notification',
        scheduledMessageId: 'scheduledMessage', eventGroupId: 'eventGroup', miniLeagueId: 'miniLeague',
        clubLinkId: 'clubLink', roleRequestId: 'roleRequest',
      };
      const field = Object.keys(entries).find(key => key in scope);
      if (!field) throw new Error('Unsupported mixed membership resource');
      const id = (scope as unknown as Record<string, unknown>)[field];
      if (typeof id !== 'string') throw new Error('Resource identifier required');
      return lookupEntityClub(ctx, entries[field], id);
    } });
  } catch (error) { session.dispose(); throw error; }
}