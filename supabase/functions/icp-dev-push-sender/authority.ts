import type { IcpNativeDeliveryAuthority, Reservation } from './delivery.ts';

type Result<T> = { Ok: T } | { Err: string };
export interface NativeQueueActor {
  reserve_native_push(): Promise<Result<Array<{ receipt: string; user: string; token: string; platform: string;
    notification_id: string; kind: string; related_id: string[]; scope: string; key: string; body?: string[] }>>>;
  settle_native_push(receipt: string, outcome: string): Promise<Result<null>>;
}

const TITLES: Record<string, string> = {
  message_chat: 'New message', message_mention: 'You were mentioned', message_reply: 'New reply to you', event_invite: 'New event', event_reminder: 'Event reminder',
  event_cancelled: 'Event cancelled', duty_reminder: 'Duty reminder', duty_completed: 'Duty completed',
  photo_prompt_reminder: 'Add your photos', event_points_reminder: 'Event points', photo_uploaded: 'New photos',
  photo_comment: 'New comment', photo_reaction: 'New reaction', comment_reply: 'New reply', club_news: 'Club news',
  payment_reminder: 'Payment reminder', competition_broadcast: 'Competition update', schedule_refresh: 'Schedule updated',
  club_invite: 'Club invitation', team_invite: 'Team invitation', membership_removed: 'Membership update',
  role_removed: 'Role update', join_request: 'Join request', join_request_approved: 'Join request approved',
  join_request_declined: 'Join request declined', pitch_board_substitution: 'Sub due',
};

/** Same wording as the in-app notification: per-kind title plus the stored ICP body. */
export function pushText(kind: string, body: string | undefined) {
  // ICP stores "Title<U+001F>text" when it knows the sender/chat name.
  const [named, rest] = (body ?? '').includes('\u001f') ? (body ?? '').split('\u001f') : ['', body ?? ''];
  const clean = rest.replace(/\s+/g, ' ').trim().slice(0, 240);
  const title = named.trim().slice(0, 80) || TITLES[kind] || (kind.startsWith('join_request') ? 'Join request' : 'Ignite Club HQ');
  return { title, body: clean || 'You have a new update.' };
}

/** No notification bodies, directory reads, Supabase writes or legacy recovery.
 * Canonical ICP reservation is the only source of recipient and device data.
 */
export function createNativeQueueAuthority(actor: NativeQueueActor): IcpNativeDeliveryAuthority {
  return {
    async reserveNext(): Promise<Reservation | undefined> {
      const result = await actor.reserve_native_push();
      if ('Err' in result) throw new Error('ICP native reservation refused');
      const row = result.Ok[0];
      if (!row) return undefined;
      // Keep the same account-bound navigation convention as existing ICP push.
      let url = '/notifications';
      const related = row.related_id[0];
      if (['message_chat', 'message_mention', 'message_reply'].includes(row.kind) && (related || row.scope)) {
        url = `/messages?${new URLSearchParams({ conversation: related || row.scope, message: row.key })}`;
      } else if (row.kind.startsWith('event') && related) url = `/events/${encodeURIComponent(related)}`;
      else if (row.kind === 'club_news' && related) url = `/news/${encodeURIComponent(related)}`;
      return { receipt: row.receipt,
        device: { user: row.user, token: row.token, platform: row.platform, active: true },
        payload: { notification: pushText(row.kind, row.body?.[0]), data: {
          ignite_backend: 'icp-dev', recipient: row.user, notification_id: row.notification_id, kind: row.kind, url,
        } },
      };
    },
    async settle(receipt, outcome) {
      // Initial rollout deliberately holds definite failures too. Retry policy
      // must be added on ICP, never silently invented by the hosting adapter.
      const status = outcome.status === 'retry' ? 'held' : outcome.status;
      return 'Ok' in await actor.settle_native_push(receipt, status);
    },
  };
}