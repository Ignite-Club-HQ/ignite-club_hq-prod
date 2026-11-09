import { createDevFcmTransport } from './fcm.ts';

/** These are ICP consensus operations, not Supabase tables or local locks.
 * The adapter must reject unknown methods on older canisters; never fall back
 * to notification-level recover/claim/acknowledge or a local attempt journal.
 */
export interface IcpNativeDeliveryAuthority {
  reserveNext(): Promise<Reservation | undefined>;
  settle(receipt: string, outcome: DeliveryOutcome): Promise<boolean>;
}

export interface Reservation {
  receipt: string;
  device: { user: string; platform: string; token: string; active: boolean };
  payload: {
    data: Record<string, string>;
    notification: { title: string; body: string };
  };
}

export type DeliveryOutcome =
  | { status: 'accepted' }
  | { status: 'held' }
  | { status: 'inactive'; code: 'unregistered' }
  | { status: 'retry'; code: 'provider_transient' }
  | { status: 'stopped'; code: 'provider_rejected' | 'invalid_reservation' };

export interface DeliveryReport {
  accepted: number;
  held: number;
  inactive: number;
  retry: number;
  stopped: number;
  complete: boolean;
}

type Send = ReturnType<typeof createDevFcmTransport>;

function failureOutcome(status: number, body: unknown): DeliveryOutcome {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = body.error;
    if (error && typeof error === 'object' && 'details' in error && Array.isArray(error.details) &&
      error.details.some(detail => detail && typeof detail === 'object' &&
        detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' && detail.errorCode === 'UNREGISTERED')) {
      return { status: 'inactive', code: 'unregistered' };
    }
  }
  if (status === 429 || status >= 500) return { status: 'retry', code: 'provider_transient' };
  return { status: 'stopped', code: 'provider_rejected' };
}

/** Bounded invocation. ICP atomically selects/reserves one current native device,
 * with live audience/preferences/mutes and source/device/worker-generation checks.
 * Receipt ownership, retries/backoff, inactivity and unknown-outcome retention
 * all belong to ICP. Supabase holds only transient delivery data and credentials.
 */
export async function deliverReservedNativePush(
  authority: IcpNativeDeliveryAuthority,
  send: Send,
  limit = 10,
): Promise<DeliveryReport> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('Invalid TEST delivery batch');
  const report: DeliveryReport = { accepted: 0, held: 0, inactive: 0, retry: 0, stopped: 0, complete: false };
  for (let i = 0; i < limit; i++) {
    // A rejected/lost reserve reply stops before Firebase. ICP must retain any
    // uncertain reservation; a following invocation cannot re-adopt it.
    const reservation = await authority.reserveNext();
    if (!reservation) return { ...report, complete: true };
    if (typeof reservation.receipt !== 'string' || !reservation.receipt || reservation.receipt.length > 256) {
      throw new Error('TEST delivery reservation unconfirmed');
    }
    let outcome: DeliveryOutcome;
    if (!reservation.device || !reservation.payload || !reservation.payload.data ||
      reservation.payload.data.recipient !== reservation.device.user ||
      reservation.payload.data.ignite_backend !== 'icp-dev' ||
      !['android', 'ios'].includes(reservation.device.platform)) {
      outcome = { status: 'stopped', code: 'invalid_reservation' };
    } else {
      try {
        const result = await send(reservation.device, reservation.payload);
        outcome = result.ok ? { status: 'accepted' } : failureOutcome(result.status, result.body);
      } catch {
        // Includes timeouts and malformed success: may have been accepted.
        // No local replay, fail(), recover(), pruning or fallback sender.
        outcome = { status: 'held' };
      }
    }
    // Lost acknowledgement stops the whole invocation. Do not attempt a second
    // settlement/send; ICP retains its original reservation for investigation.
    if (!await authority.settle(reservation.receipt, outcome)) {
      throw new Error('TEST delivery settlement unconfirmed; do not replay');
    }
    report[outcome.status] += 1;
  }
  return report;
}