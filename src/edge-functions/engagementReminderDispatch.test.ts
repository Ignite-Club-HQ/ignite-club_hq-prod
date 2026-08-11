/**
 * Reliability tests for engagement-reminder dispatch.
 *
 * Defects covered:
 *  1. cooldown logs written for notification batches that failed to insert
 *  2. cooldown-log insert errors ignored, letting the run report success
 */
import { describe, it, expect } from "vitest";
import {
  BATCH_SIZE,
  CooldownLogWriteError,
  dispatchReminders,
  type ReminderEntry,
} from "../../supabase/functions/send-engagement-reminders/dispatch.ts";

const entry = (n: number): ReminderEntry => ({
  notification: { user_id: `u${n}`, type: "engagement_reminder", message: `m${n}` },
  log: { user_id: `u${n}`, unread_messages_count: n, unread_photos_count: 0 },
});

type Behaviour = (table: string, rows: any[], call: number) => { error: any } | undefined;

function fakeClient(behaviour: Behaviour = () => undefined) {
  const inserted: Record<string, any[][]> = { notifications: [], engagement_reminder_log: [] };
  const calls: Record<string, number> = { notifications: 0, engagement_reminder_log: 0 };
  return {
    inserted,
    from(table: string) {
      return {
        async insert(rows: any[]) {
          const call = calls[table]++;
          const res = behaviour(table, rows, call);
          if (res?.error) return res;
          inserted[table].push(rows);
          return { error: null };
        },
      };
    },
  };
}

const flat = (batches: any[][]) => batches.flat();

describe("engagement reminder dispatch", () => {
  it("writes cooldown rows for a successful notification batch", async () => {
    const c = fakeClient();
    const res = await dispatchReminders(c, [entry(1), entry(2)]);
    expect(res).toEqual({ totalSent: 2, failedNotificationBatches: 0 });
    expect(flat(c.inserted.engagement_reminder_log).map((r) => r.user_id)).toEqual(["u1", "u2"]);
  });

  it("writes no cooldown rows when the notification batch fails", async () => {
    const c = fakeClient((table) =>
      table === "notifications" ? { error: { code: "23505" } } : undefined,
    );
    const res = await dispatchReminders(c, [entry(1), entry(2)]);
    expect(res.totalSent).toBe(0);
    expect(res.failedNotificationBatches).toBe(1);
    expect(c.inserted.engagement_reminder_log).toEqual([]);
  });

  it("logs cooldowns only for successful batches on mixed results", async () => {
    // 2 batches: first fails, second succeeds.
    const entries = Array.from({ length: BATCH_SIZE + 3 }, (_, i) => entry(i));
    const c = fakeClient((table, _rows, call) =>
      table === "notifications" && call === 0 ? { error: { code: "XX000" } } : undefined,
    );
    const res = await dispatchReminders(c, entries);
    expect(res.totalSent).toBe(3);
    expect(res.failedNotificationBatches).toBe(1);
    const logged = flat(c.inserted.engagement_reminder_log).map((r) => r.user_id);
    expect(logged).toEqual([`u${BATCH_SIZE}`, `u${BATCH_SIZE + 1}`, `u${BATCH_SIZE + 2}`]);
  });

  it("keeps notification-to-log association across batches larger than 500", async () => {
    const entries = Array.from({ length: BATCH_SIZE * 2 + 7 }, (_, i) => entry(i));
    const c = fakeClient();
    const res = await dispatchReminders(c, entries);
    expect(res.totalSent).toBe(entries.length);
    const notifs = flat(c.inserted.notifications);
    const logs = flat(c.inserted.engagement_reminder_log);
    expect(logs.length).toBe(notifs.length);
    for (let i = 0; i < logs.length; i++) {
      expect(logs[i].user_id).toBe(notifs[i].user_id);
      expect(logs[i].unread_messages_count).toBe(i);
    }
    // No duplicates.
    expect(new Set(logs.map((r) => r.user_id)).size).toBe(logs.length);
  });

  it("throws a sanitized error when cooldown-log insertion fails", async () => {
    const c = fakeClient((table) =>
      table === "engagement_reminder_log"
        ? { error: { code: "42501", message: "permission denied for relation ..." } }
        : undefined,
    );
    await expect(dispatchReminders(c, [entry(1)])).rejects.toBeInstanceOf(CooldownLogWriteError);
    try {
      await dispatchReminders(c, [entry(1)]);
    } catch (e: any) {
      expect(e.message).toBe("engagement_cooldown_log_write_failed");
      expect(e.message).not.toMatch(/permission denied/);
    }
  });

  it("is a no-op for an empty reminder list", async () => {
    const c = fakeClient();
    expect(await dispatchReminders(c, [])).toEqual({ totalSent: 0, failedNotificationBatches: 0 });
    expect(c.inserted.notifications).toEqual([]);
    expect(c.inserted.engagement_reminder_log).toEqual([]);
  });
});
