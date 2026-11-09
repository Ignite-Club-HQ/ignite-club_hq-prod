import type { IcpNativeDeliveryAuthority, Reservation } from './delivery.ts';

type Result<T> = { Ok: T } | { Err: string };
export interface NativeQueueActor {
  reserve_native_push(): Promise<Result<Array<{ receipt: string; user: string; token: string; platform: string;
    notification_id: string; kind: string; related_id: string[]; scope: string; key: string }>>>;
  settle_native_push(receipt: string, outcome: string): Promise<Result<null>>;
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
      if (row.kind === 'message_chat' && (related || row.scope)) {
        url = `/messages?${new URLSearchParams({ conversation: related || row.scope, message: row.key })}`;
      } else if (row.kind.startsWith('event') && related) url = `/events/${encodeURIComponent(related)}`;
      else if (row.kind === 'club_news' && related) url = `/news/${encodeURIComponent(related)}`;
      return { receipt: row.receipt,
        device: { user: row.user, token: row.token, platform: row.platform, active: true },
        payload: { notification: { title: 'Ignite Club HQ', body: 'You have a new update.' }, data: {
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