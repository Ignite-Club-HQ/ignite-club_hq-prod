/**
 * Regression contracts for inflated engagement-reminder counts.
 *
 * This Edge Function imports remote Deno modules and starts a server during
 * evaluation, so the jsdom runner cannot import it safely. These source-level
 * contracts guard the exact production data sources and safety boundaries.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/send-engagement-reminders/index.ts"),
  "utf8",
);
const dispatchSource = readFileSync(
  resolve(process.cwd(), "supabase/functions/send-engagement-reminders/dispatch.ts"),
  "utf8",
);
const atomicMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260811113952_139285ef-b465-4da2-8058-c73f6feaaceb.sql",
  ),
  "utf8",
);

describe("send-engagement-reminders count accuracy", () => {
  it("uses actual photo views and never reactions as a seen-state proxy", () => {
    expect(source).toContain('.from("photo_views")');
    expect(source).toContain("viewedPhotoSet");
    expect(source).toContain("!viewedPhotoSet.has(`${userId}:${p.id}`)");
    expect(source).not.toContain('.from("photo_reactions")');
  });

  it("derives unread messages from the same notification source as the inbox badge", () => {
    expect(source).toContain('"notifications"');
    expect(source).toContain('.eq("is_read", false)');
    expect(source).toContain("BADGE_COUNTED_NOTIFICATION_TYPES");
    expect(source).not.toMatch(/\.from\("message_reads"\)/);
  });

  it("counts only the five message categories included by the badge RPC", () => {
    const types = source.match(
      /const BADGE_COUNTED_NOTIFICATION_TYPES = \[([\s\S]*?)\];/,
    )?.[1] ?? "";
    for (const type of [
      "team_message",
      "club_message",
      "group_message",
      "broadcast",
      "direct_message",
    ]) {
      expect(types).toContain(`"${type}"`);
    }
    expect(types).not.toContain("message_reply");
    expect(types).not.toContain("message_mention");
  });

  it("drops orphan message notifications whose related message no longer exists", () => {
    expect(source).toContain("resolveExisting");
    expect(source).toMatch(/existingByType\[r\.type\]\?\.has\(r\.related_id\)/);
  });

  it("does not count a DM whose latest message was sent by the recipient", () => {
    expect(source).toContain("latestDmAuthor");
    expect(source).toContain("author !== r.user_id");
  });

  it("excludes the recipient's own photo uploads", () => {
    expect(source).toContain("p.uploader_id !== userId");
  });

  it("paginates bulk reads and throws rather than using truncated rows", () => {
    expect(source).toContain("const PAGE_SIZE = 1000");
    expect(source).toMatch(/\.range\(offset, offset \+ PAGE_SIZE - 1\)/);
    expect(source).toMatch(/if \(error\)[\s\S]{0,180}throw error/);
    expect(source).toMatch(/pagination cap reached[\s\S]{0,220}aborting run/);
  });

  it("has an explicit sanity ceiling that suppresses implausible counts", () => {
    expect(source).toMatch(/const UNREAD_SANITY_CEILING = \d+/);
    expect(source).toMatch(
      /unreadMessages > UNREAD_SANITY_CEILING \|\| unseenPhotos > UNREAD_SANITY_CEILING/,
    );
    expect(source).toContain("continue;");
  });

  it("keeps the five-item combined threshold", () => {
    expect(source).toContain("const totalUnread = unreadMessages + unseenPhotos");
    expect(source).toContain("if (totalUnread < 5) continue");
  });

  it("retains cron authentication and the two-day per-user cooldown", () => {
    expect(source).toContain("isAuthorizedCronCaller(req)");
    expect(source).toContain("2 * 24 * 60 * 60 * 1000");
    expect(source).toContain('.gte("sent_at", twoDaysAgo)');
  });
});

describe("send-engagement-reminders remaining delivery safety", () => {
  it("does not cooldown recipients whose notification insert failed", () => {
    expect(source).toContain("dispatchReminders(supabase, reminders)");
    expect(dispatchSource).toContain('supabase.rpc("insert_engagement_reminders_atomic"');
    expect(atomicMigration).toMatch(
      /insert into public\.notifications[\s\S]*insert into public\.engagement_reminder_log/,
    );
    expect(atomicMigration).toContain("language plpgsql");
  });

  it("checks cooldown-log insertion errors instead of silently losing retries", () => {
    expect(dispatchSource).toMatch(/const \{ data, error \} = await supabase\.rpc/);
    expect(dispatchSource).toMatch(/if \(error\)[\s\S]{0,500}failedBatches\+\+/);
    expect(source).toMatch(/if \(dispatch\.failedBatches > 0\)/);
    expect(source).toContain('error: "engagement_reminder_persist_failed"');
  });
});
