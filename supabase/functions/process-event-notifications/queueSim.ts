/**
 * In-memory simulation of `public.push_delivery_queue` +
 * `claim_push_delivery_jobs()` semantics.
 *
 * This mirrors the SQL contract 1:1 (see
 * supabase/tests/push_delivery_queue_test.sql, which asserts the same rules
 * against a real Postgres). It exists so the *worker* can be exercised end to
 * end — draining, reclaiming, retrying, concurrency — without Docker.
 */
import type { Job, QueueUpdate } from "../process-push-delivery-queue/delivery.ts";

export interface Row {
  id: string;
  notification_id: string;
  user_id: string;
  payload: Job["payload"];
  status: "pending" | "processing" | "delivered" | "skipped" | "failed";
  attempt_count: number;
  next_attempt_at: number;
  claimed_at: number | null;
  completed_at: number | null;
  last_error: string | null;
  created_at: number;
}

export const STALE_MS = 2 * 60 * 1000;

export class QueueSim {
  rows: Row[] = [];
  /** Simulated clock, ms. */
  now = 1_000_000;
  private seq = 0;

  /** Mirrors enqueue_event_push_v2's ON CONFLICT (notification_id) DO NOTHING. */
  enqueue(notificationId: string, userId: string, payload: Job["payload"]): boolean {
    if (this.rows.some((r) => r.notification_id === notificationId)) return false;
    this.rows.push({
      id: `job-${++this.seq}`,
      notification_id: notificationId,
      user_id: userId,
      payload,
      status: "pending",
      attempt_count: 0,
      next_attempt_at: this.now,
      claimed_at: null,
      completed_at: null,
      last_error: null,
      created_at: this.now + this.seq,
    });
    return true;
  }

  /** FOR UPDATE SKIP LOCKED equivalent: claiming flips status atomically. */
  claim(limit: number): Job[] {
    const eligible = this.rows
      .filter(
        (r) =>
          (r.status === "pending" && r.next_attempt_at <= this.now) ||
          (r.status === "processing" && r.claimed_at !== null && r.claimed_at < this.now - STALE_MS),
      )
      .sort((a, b) => a.created_at - b.created_at)
      .slice(0, Math.max(1, Math.min(limit, 100)));
    for (const r of eligible) {
      r.status = "processing";
      r.claimed_at = this.now;
    }
    return eligible.map((r) => ({
      id: r.id,
      notification_id: r.notification_id,
      user_id: r.user_id,
      payload: r.payload,
      attempt_count: r.attempt_count,
    }));
  }

  /** Conditional update: only applies while the row is still `processing`. */
  update(jobId: string, patch: QueueUpdate): { updated: number; error: null } {
    const row = this.rows.find((r) => r.id === jobId);
    if (!row || row.status !== "processing") return { updated: 0, error: null };
    row.status = patch.status;
    row.attempt_count = patch.attempt_count;
    row.last_error = patch.last_error;
    row.completed_at = patch.completed_at ? Date.parse(patch.completed_at) : null;
    if (patch.next_attempt_at) row.next_attempt_at = Date.parse(patch.next_attempt_at);
    return { updated: 1, error: null };
  }

  count(status: Row["status"]): number {
    return this.rows.filter((r) => r.status === status).length;
  }
}
