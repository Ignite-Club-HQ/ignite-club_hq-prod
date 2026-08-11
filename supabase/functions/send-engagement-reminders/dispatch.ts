/**
 * Reminder dispatch: notification insert + cooldown log persistence.
 *
 * Two reliability invariants this module exists to enforce:
 *  1. A cooldown log row is written ONLY for a reminder whose notification
 *     batch was successfully inserted. A failed batch must leave its
 *     recipients cooldown-free so the next run can retry them.
 *  2. Cooldown-log write failures are never ignored. They abort the run with a
 *     sanitized error so the caller cannot report `success: true` while
 *     cooldown persistence is broken (which would re-notify every user).
 */

export const BATCH_SIZE = 500;

/** One reminder, notification row and its matching cooldown log row paired. */
export interface ReminderEntry {
  notification: { user_id: string; type: string; message: string };
  log: { user_id: string; unread_messages_count: number; unread_photos_count: number };
}

/** Thrown when cooldown-log persistence fails. Message is sanitized. */
export class CooldownLogWriteError extends Error {
  readonly code = "engagement_cooldown_log_write_failed";
  constructor() {
    super("engagement_cooldown_log_write_failed");
    this.name = "CooldownLogWriteError";
  }
}

export interface DispatchResult {
  /** Notifications actually inserted. */
  totalSent: number;
  /** Notification batches that failed to insert (no cooldowns written). */
  failedNotificationBatches: number;
}

function chunkEntries(entries: ReminderEntry[], size = BATCH_SIZE): ReminderEntry[][] {
  const out: ReminderEntry[][] = [];
  for (let i = 0; i < entries.length; i += size) out.push(entries.slice(i, i + size));
  return out;
}

/**
 * Insert reminders in batches, then persist cooldown logs for the successful
 * batches only. Each batch is attempted exactly once per invocation.
 */
export async function dispatchReminders(
  supabase: any,
  entries: ReminderEntry[],
): Promise<DispatchResult> {
  if (entries.length === 0) return { totalSent: 0, failedNotificationBatches: 0 };

  const batches = chunkEntries(entries);
  const confirmedLogs: ReminderEntry["log"][] = [];
  let totalSent = 0;
  let failedNotificationBatches = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const { error } = await supabase
      .from("notifications")
      .insert(batch.map((e) => e.notification));
    if (error) {
      // Sanitised, aggregate-only log: batch position and size, never message
      // bodies or user identifiers.
      failedNotificationBatches++;
      console.error(
        `[EngagementReminder] notification batch insert failed batchIndex=${b} batchSize=${batch.length} code=${(error as any)?.code ?? ""}`,
      );
      continue; // no cooldown rows for this batch — retry next run
    }
    totalSent += batch.length;
    // Only batches confirmed inserted contribute cooldown rows, and each
    // recipient appears exactly once so no duplicate cooldowns are produced.
    for (const e of batch) confirmedLogs.push(e.log);
  }

  for (let i = 0; i < confirmedLogs.length; i += BATCH_SIZE) {
    const logBatch = confirmedLogs.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("engagement_reminder_log").insert(logBatch);
    if (error) {
      console.error(
        `[EngagementReminder] cooldown log insert FAILED offset=${i} batchSize=${logBatch.length} confirmedNotifications=${totalSent} code=${(error as any)?.code ?? ""}`,
      );
      throw new CooldownLogWriteError();
    }
  }

  return { totalSent, failedNotificationBatches };
}
