import { queryOptions } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { withFeatureBackend } from '@/live/featureRouter';
import { writeOnce } from '@/live/clubScope';
import type { PitchPosition } from '@/components/pitch/PositionBadge';

const positions: readonly string[] = ['GK', 'DEF', 'MID', 'FWD'];
const canonicalPositions = (values: string[]) => values.filter(
  (value): value is PitchPosition => positions.includes(value),
);

export function pitchPlayerPositionsQuery(teamId: string, userId: string | undefined, icp: boolean) {
  return queryOptions({
    queryKey: ['team-player-positions', teamId, userId, icp],
    queryFn: async () => {
      if (icp) return withFeatureBackend('membership', {
        supabase: async () => { throw new Error('ICP player positions required'); },
        icp: async ctx => {
          const { getLiveTeamPlayerPositionsV2 } = await import('@/live/features/club');
          const rows = await getLiveTeamPlayerPositionsV2(ctx, teamId);
          return rows.map(row => ({
            user_id: row.member_id.replace(/^principal:/, ''),
            child_id: null,
            preferred_positions: canonicalPositions(row.positions),
            jersey_number: Array.isArray(row.jersey_number)
              ? row.jersey_number[0] ?? null : row.jersey_number ?? null,
          }));
        },
      }, { teamId });
      const { data, error } = await supabase.from('team_player_positions').select('*').eq('team_id', teamId);
      if (error) throw error;
      return (data ?? []).map(row => ({
        user_id: row.user_id, child_id: row.child_id,
        preferred_positions: canonicalPositions(row.preferred_positions ?? []),
        jersey_number: row.jersey_number,
      }));
    },
    staleTime: 30_000,
    gcTime: 10 * 60_000,
  });
}

export async function readPitchNotificationPreference(userId: string, icp: boolean): Promise<boolean> {
  if (icp) return withFeatureBackend('notifications', {
    supabase: async () => { throw new Error('ICP preferences required'); },
    icp: async ctx => {
      const { getLiveNotificationPreferences } = await import('@/live/features/notifications');
      return (await getLiveNotificationPreferences(ctx, userId)).pitchBoardEnabled;
    },
  }, { shared: 'person' });
  const { data, error } = await supabase.from('notification_preferences')
    .select('pitch_board_enabled').eq('user_id', userId).single();
  if (error) throw error;
  return data?.pitch_board_enabled ?? true;
}

/** Sub-due alert from the open board to the runner and match staff (no child names). */
export async function notifyIcpSubstitutionDue(teamId: string, eventId: string | null, userId: string, key: string) {
  return withFeatureBackend('membership', {
    supabase: async () => { throw new Error('ICP substitution reminder required'); },
    icp: async ctx => {
      const caller = ctx.identity?.getPrincipal().toText();
      if (!caller || caller !== userId.replace(/^principal:/, '')) throw new Error('Pitch-board account changed');
      if (teamId.startsWith('event-group-')) {
        const { notifyLiveGroupPitch } = await import('@/live/features/events');
        return notifyLiveGroupPitch(ctx, teamId.slice('event-group-'.length), 'substitution', '', key);
      }
      // Same audience as email mode: the runner, the team's coaches/admins and
      // the linked match's Subs Manager, honouring the team's alert switches.
      const { livePitchRecipients } = await import('@/components/pitch/hooks/livePitchNotifications');
      const recipients = await livePitchRecipients(ctx, teamId, eventId, caller, true, true);
      const userIds = [...new Set(recipients.userIds.map(id => id.replace(/^principal:/, '')))];
      const { fanOutLiveNotifications } = await import('@/live/features/notifications');
      return fanOutLiveNotifications(ctx, {
        userIds, clubId: recipients.clubId, kind: 'pitch_board_substitution',
        // Child names are PII; the alert carries only the summary.
        body: 'A planned substitution is due', relatedId: teamId,
        idempotencyKeyPrefix: key,
      });
    },
  }, writeOnce(teamId.startsWith('event-group-') ? { eventGroupId: teamId.slice('event-group-'.length) } : { teamId }));
}
/**
 * Registers the board's upcoming sub due times on the secure alert service so
 * staff still get the alert with the phone locked or the app closed. Each call
 * replaces the board's list; an empty list cancels. No child names are sent.
 */
export async function scheduleIcpSubAlerts(
  teamId: string, eventId: string | null, userId: string,
  alerts: { key: string; dueMs: number }[],
) {
  return withFeatureBackend('membership', {
    supabase: async () => { throw new Error('ICP substitution reminder required'); },
    icp: async ctx => {
      const caller = ctx.identity?.getPrincipal().toText();
      if (!caller || caller !== userId.replace(/^principal:/, '')) throw new Error('Pitch-board account changed');
      const { connectLiveNotificationQueue } = await import('@/live/domains');
      const { actor } = await connectLiveNotificationQueue(ctx.target, ctx.identity);
      let clubId = '';
      let userIds: string[] = [];
      if (alerts.length > 0) {
        const { livePitchRecipients } = await import('@/components/pitch/hooks/livePitchNotifications');
        const recipients = await livePitchRecipients(ctx, teamId, eventId, caller, true, true);
        clubId = recipients.clubId;
        userIds = [...new Set(recipients.userIds.map(id => id.replace(/^principal:/, '')))];
      } else {
        clubId = 'none';
      }
      const result = await actor.schedule_pitch_sub_alerts(
        teamId, clubId, userIds, teamId,
        // The shared-match relay adds this namespace to the open-board key.
        // Use the identical ID for its server timer, not a second notification.
        [...new Map(alerts.map(a => [a.key, a])).values()].map(a => ({
          key: teamId.startsWith('event-group-') ? `pitch-${teamId.slice('event-group-'.length)}-${a.key}` : a.key,
          due_ms: BigInt(Math.max(0, Math.round(a.dueMs))),
        })),
      );
      if ('Err' in result) throw new Error(result.Err);
      return Number(result.Ok);
    },
  }, writeOnce(teamId.startsWith('event-group-') ? { eventGroupId: teamId.slice('event-group-'.length) } : { teamId }));
}

/** One alert per due window, even when multiple players change together. */
export function pitchSubAlertKey(runId: string, sub: { half: number; time: number; playerOut: { id: string }; playerIn: { id: string } }) {
  return `pitch-sub-${runId}-${sub.half}-${Math.round(sub.time)}`.slice(0, 128);
}

/** ICP's registered server timer owns closed-board substitution delivery. */
export function shouldTriggerImmediatePitchCheck(source: string, icp: boolean): boolean {
  return !(icp && source === 'client-pending-sub-sync');
}
