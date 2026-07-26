/**
 * Push delivery worker logic, extracted so every outcome path is unit
 * testable without a network or a database.
 *
 * Delivery guarantee: **database idempotency + at-least-once processing.**
 * True exactly-once *device* delivery is not achievable across an HTTP hop
 * we do not control: if `send-push-notification` succeeds but our status
 * update fails, the job stays `processing` and is reclaimed after the stale
 * window, which can produce a second device push. `send-push-notification`
 * has its own duplicate claim on `notification_id`, which suppresses most of
 * those, but the boundary is documented rather than pretended away.
 */

export const BATCH = 30;
export const MAX_ATTEMPTS = 5;
export const PUSH_TIMEOUT_MS = 20_000;

export type Classification = "delivered" | "skipped" | "retry" | "permanent";

export interface Job {
  id: string;
  notification_id: string;
  user_id: string;
  payload: {
    title: string;
    body: string;
    url: string;
    tag: string;
    notificationType: string;
  };
  attempt_count: number;
}

/** 30s, 2m, 8m, 30m, capped at 2h. */
export function backoffSeconds(attempt: number): number {
  return Math.min(30 * Math.pow(4, Math.max(1, attempt) - 1), 60 * 60 * 2);
}

/**
 * HTTP 200 alone is never treated as proof of delivery — the sender's body
 * is interpreted. `sent === 0` (preference disabled, no subscription,
 * duplicate suppressed) is a *skip*, not a delivery.
 */
export function classify(input: {
  ok: boolean;
  status: number;
  body: any | null;
  timedOut?: boolean;
  networkError?: boolean;
}): { classification: Classification; note?: string } {
  if (input.timedOut) return { classification: "retry", note: "timeout" };
  if (input.networkError) return { classification: "retry", note: "network" };

  if (input.ok) {
    if (input.body === null || typeof input.body !== "object") {
      // Cannot verify. Do not re-send (a duplicate device push is worse than
      // an unverified record) but keep the evidence on the row.
      return { classification: "delivered", note: "unverified_response_body" };
    }
    if (input.body.skipped === true) return { classification: "skipped", note: "sender_skipped" };
    if (typeof input.body.sent === "number") {
      return input.body.sent > 0
        ? { classification: "delivered" }
        : { classification: "skipped", note: String(input.body.message ?? "sent=0") };
    }
    if (input.body.error) return { classification: "retry", note: "ok_with_error_body" };
    return { classification: "delivered", note: "no_sent_field" };
  }

  if (input.status === 400 || input.status === 404 || input.status === 410) {
    return { classification: "permanent", note: `http_${input.status}` };
  }
  if (input.status === 429 || input.status >= 500) {
    return { classification: "retry", note: `http_${input.status}` };
  }
  // 401/403 and other 4xx: configuration problems — retry (bounded) so a
  // transient auth/deploy blip recovers, then terminal.
  return { classification: "retry", note: `http_${input.status}` };
}

export interface QueueUpdate {
  status: "delivered" | "skipped" | "failed" | "pending";
  attempt_count: number;
  completed_at?: string | null;
  next_attempt_at?: string;
  last_error: string | null;
}

/** Terminal/retry bookkeeping for one classified attempt. */
export function buildUpdate(
  classification: Classification,
  attempt: number,
  note: string | undefined,
  now: number,
): QueueUpdate {
  if (classification === "delivered") {
    return {
      status: "delivered",
      attempt_count: attempt,
      completed_at: new Date(now).toISOString(),
      last_error: note ?? null,
    };
  }
  if (classification === "skipped") {
    return {
      status: "skipped",
      attempt_count: attempt,
      completed_at: new Date(now).toISOString(),
      last_error: note ?? null,
    };
  }
  if (classification === "permanent" || attempt >= MAX_ATTEMPTS) {
    return {
      status: "failed",
      attempt_count: attempt,
      completed_at: new Date(now).toISOString(),
      last_error: `${classification === "permanent" ? "permanent" : "attempts_exhausted"}: ${note ?? ""}`.trim(),
    };
  }
  return {
    status: "pending",
    attempt_count: attempt,
    completed_at: null,
    next_attempt_at: new Date(now + backoffSeconds(attempt) * 1000).toISOString(),
    last_error: `retry: ${note ?? ""}`.trim(),
  };
}

export interface Deps {
  /** POST the push. Must not throw for HTTP errors. */
  sendPush(job: Job, signal: AbortSignal): Promise<{ ok: boolean; status: number; body: any | null }>;
  /**
   * Persist the outcome. MUST be conditional on the row still being
   * `processing` so a concurrent/duplicate worker cannot downgrade an
   * already-`delivered` row to `skipped`/`failed`. Returns the number of
   * rows actually updated so a lost update is detectable.
   */
  updateJob(jobId: string, patch: QueueUpdate): Promise<{ updated: number; error: unknown | null }>;
  now?: () => number;
  timeoutMs?: number;
}

export interface WorkerCounters {
  claimed: number;
  delivered: number;
  skipped: number;
  retried: number;
  failed: number;
  status_update_failures: number;
}

export async function processJob(job: Job, deps: Deps, counters: WorkerCounters): Promise<void> {
  const now = deps.now ?? Date.now;
  const attempt = (job.attempt_count || 0) + 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? PUSH_TIMEOUT_MS);

  let classification: Classification;
  let note: string | undefined;
  try {
    const res = await deps.sendPush(job, controller.signal);
    ({ classification, note } = classify({ ok: res.ok, status: res.status, body: res.body }));
  } catch (err) {
    const aborted = controller.signal.aborted || (err as any)?.name === "AbortError";
    ({ classification, note } = classify(
      aborted ? { ok: false, status: 0, body: null, timedOut: true } : { ok: false, status: 0, body: null, networkError: true },
    ));
  } finally {
    clearTimeout(timer);
  }

  const patch = buildUpdate(classification, attempt, note, now());
  const { updated, error } = await deps.updateJob(job.id, patch);

  if (error || updated === 0) {
    // Never leave a successfully delivered job silently mismarked: record it
    // so the run reports partial success. The row stays `processing` and is
    // reclaimed by the stale-claim path (at-least-once).
    counters.status_update_failures++;
    return;
  }

  if (patch.status === "delivered") counters.delivered++;
  else if (patch.status === "skipped") counters.skipped++;
  else if (patch.status === "failed") counters.failed++;
  else counters.retried++;
}

export async function processBatch(jobs: Job[], deps: Deps): Promise<WorkerCounters> {
  const counters: WorkerCounters = {
    claimed: jobs.length,
    delivered: 0,
    skipped: 0,
    retried: 0,
    failed: 0,
    status_update_failures: 0,
  };
  // One failing recipient must never block the others.
  await Promise.allSettled(jobs.map((job) => processJob(job, deps, counters)));
  return counters;
}
