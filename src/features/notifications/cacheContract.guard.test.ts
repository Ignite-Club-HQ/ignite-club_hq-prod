import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { notificationCacheRoots } from "./queryKeys";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("notification cache migration characterization", () => {
  it("covers every currently shared notification/unread cache family", () => {
    const currentConsumers = [
      read("src/pages/NotificationsPage.tsx"),
      read("src/components/layout/AppHeader.tsx"),
      read("src/hooks/useAuth.tsx"),
      read("src/lib/markChatScopeRead.ts"),
      read("src/pages/MessagesPage.tsx"),
    ].join("\n");

    const properties = [
      "lists",
      "recent",
      "globalUnread",
      "clubUnread",
      "messageUnread",
      "clubMessageUnread",
      "chatGroupUnread",
    ] as const;
    expect(notificationCacheRoots).toHaveLength(properties.length);
    for (const property of properties) {
      expect(
        currentConsumers,
        `missing canonical consumer for notificationKeys.${property}`,
      ).toContain(`notificationKeys.${property}`);
    }
  });

  it("characterizes the current account and club scoping before migration", () => {
    const page = read("src/pages/NotificationsPage.tsx");
    const header = read("src/components/layout/AppHeader.tsx");

    expect(page).toContain("notificationKeys.list(user?.id, activeClubFilter)");
    expect(header).toContain(
      "notificationKeys.recentFor(user?.id, activeClubFilter)",
    );
    expect(header).toContain(
      "notificationKeys.clubUnreadFor(user?.id, activeClubFilter)",
    );
  });

  it("uses the canonical contract in every migrated cross-cutting consumer", () => {
    for (const path of [
      "src/pages/NotificationsPage.tsx",
      "src/components/layout/AppHeader.tsx",
      "src/hooks/useAuth.tsx",
      "src/pages/MessagesPage.tsx",
      "src/lib/markChatScopeRead.ts",
    ]) {
      expect(read(path), `${path} should import the canonical keys`).toContain(
        '@/features/notifications/queryKeys',
      );
    }
  });

  it("characterizes user-filtered realtime ownership and cleanup", () => {
    const realtimeHook = read("src/features/notifications/useNotificationRealtime.ts");

    expect(realtimeHook).toContain("`notifications-page-${userId}`");
    expect(realtimeHook).toContain("filter: `user_id=eq.${userId}`");
    expect(realtimeHook).toContain("supabase.removeChannel(channel)");
  });

  it("keeps notification consumers free from whole-cache invalidation", () => {
    const consumers = [
      read("src/pages/NotificationsPage.tsx"),
      read("src/components/layout/AppHeader.tsx"),
      read("src/hooks/useAuth.tsx"),
    ].join("\n");
    expect(consumers).not.toMatch(/queryClient\.invalidateQueries\(\s*\)/);
  });
});
