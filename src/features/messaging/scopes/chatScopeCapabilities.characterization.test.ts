import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_SCOPE_ADAPTERS } from "./chatScopeAdapters";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");

describe("chat scope capability source parity", () => {
  it("keeps team attachments, vault, polls, pins, gallery and announcement rows available", () => {
    const source = page("TeamChatPage.tsx");
    expect(CHAT_SCOPE_ADAPTERS.team.capabilities).toMatchObject({
      attachments: "supported",
      vaultPicker: "supported",
      polls: "supported",
      pinning: "supported",
      galleryPublishing: "conditional",
      clubAnnouncements: "supported",
    });
    expect(source).toContain("<ChatImageInput");
    expect(source).toContain("showVaultPicker={true}");
    expect(source).toContain("<CreatePollDialog");
    expect(source).toContain("<PinnedMessagesBanner");
    expect(source).toContain("canPublishToGallery={galleryWindowOpen");
    expect(source).toContain("is_club_announcement");
  });

  it("keeps club features but never exposes gallery publication", () => {
    const source = page("ClubChatPage.tsx");
    expect(CHAT_SCOPE_ADAPTERS.club.capabilities.galleryPublishing).toBe("unsupported");
    expect(source).toContain("<ChatImageInput");
    expect(source).toContain("showVaultPicker={true}");
    expect(source).toContain("<CreatePollDialog");
    expect(source).toContain("<PinnedMessagesBanner");
    expect(source).toContain("canPublishToGallery={false}");
  });

  it("keeps group vault, forwarding and gallery behavior conditional on group settings and scope", () => {
    const source = page("GroupChatPage.tsx");
    expect(CHAT_SCOPE_ADAPTERS.group.capabilities).toMatchObject({
      vaultPicker: "conditional",
      forwarding: "conditional",
      galleryPublishing: "conditional",
    });
    expect(source).toContain("showVaultPicker={!!group?.club_id}");
    expect(source).toContain("allowForwarding={group?.allow_forwarding !== false}");
    expect(source).toContain("!!group?.team_id || !!group?.mini_league_id");
  });

  it("keeps direct-message capabilities restricted for support chats and centrally disabled attachments", () => {
    const source = page("DirectMessagePage.tsx");
    expect(CHAT_SCOPE_ADAPTERS.direct.capabilities).toMatchObject({
      attachments: "conditional",
      vaultPicker: "conditional",
      polls: "unsupported",
      scheduling: "conditional",
      pinning: "conditional",
      forwarding: "conditional",
    });
    expect(source).toContain("dm_attachments_disabled");
    expect(source).toContain("!isIgniteSupportConversation && !attachmentsDisabled");
    expect(source).toContain("showVaultPicker={!!sharedClubId}");
    expect(source).toContain("canPin={!isIgniteSupportConversation");
    expect(source).toContain("scheduleMessageLocked={!scheduleProLoading && !hasSchedulePro}");
    expect(source).not.toContain("<CreatePollDialog");
  });

  it("keeps club-admin attachments, conditional vault, polls and scheduling without pins", () => {
    const source = page("ClubAdminChatPage.tsx");
    expect(CHAT_SCOPE_ADAPTERS.club_admin.capabilities).toMatchObject({
      attachments: "supported",
      vaultPicker: "conditional",
      polls: "supported",
      scheduling: "supported",
      pinning: "unsupported",
    });
    expect(source).toContain("<ChatImageInput");
    expect(source).toContain("showVaultPicker={!!conversation?.club_id}");
    expect(source).toContain("<CreatePollDialog");
    expect(source).toContain("<ScheduleMessageDialog");
    expect(source).not.toContain("<PinnedMessagesBanner");
  });

  it("keeps broadcast reading separate from app-admin-only composing", () => {
    const source = page("BroadcastChatPage.tsx");
    expect(CHAT_SCOPE_ADAPTERS.broadcast).toMatchObject({
      readBoundary: "authenticated",
      sendBoundary: "app_admin",
    });
    expect(CHAT_SCOPE_ADAPTERS.broadcast.capabilities).toMatchObject({
      attachments: "supported",
      vaultPicker: "unsupported",
      polls: "supported",
      scheduling: "conditional",
      pinning: "unsupported",
    });
    expect(source).toContain("const { isAppAdmin } = useIsAppAdmin()");
    expect(source).toContain("{isAppAdmin && (");
    expect(source).toContain("<CreatePollDialog");
    expect(source).toContain("scheduleMessageLocked={!scheduleProLoading && !hasSchedulePro}");
    expect(source).not.toContain("showVaultPicker=");
    expect(source).not.toContain("<PinnedMessagesBanner");
  });

  it("uses the broadcast adapter for shared cache and history identity", () => {
    const source = page("BroadcastChatPage.tsx");
    expect(source).toContain(
      'import { BROADCAST_CHAT_SCOPE } from "@/features/messaging/scopes/chatScopeAdapters"',
    );
    expect(source).toContain(
      "const BROADCAST_MESSAGES_QUERY_KEY = [BROADCAST_CHAT_SCOPE.cachePrefix] as const",
    );
    expect(source).toContain("table: BROADCAST_CHAT_SCOPE.messageTable");
    expect(source).not.toContain('queryKey: ["broadcast-messages"]');
    expect(source).not.toContain('setQueryData(["broadcast-messages"]');
    expect(source).not.toContain('getQueryData(["broadcast-messages"]');
  });

  it("uses the club-admin adapter for conversation cache and history scope identity", () => {
    const source = page("ClubAdminChatPage.tsx");
    expect(source).toContain("CLUB_ADMIN_CHAT_SCOPE.cachePrefix");
    expect(source).toContain("table: CLUB_ADMIN_CHAT_SCOPE.messageTable");
    expect(source).toContain(
      "scope: buildChatScopeFilter(CLUB_ADMIN_CHAT_SCOPE, conversationId)",
    );
    expect(source).not.toContain('queryKey: ["club-admin-messages", conversationId]');
    expect(source).not.toContain('cacheKeys: [["club-admin-messages", conversationId]]');
  });

  it("uses the direct-message adapter for conversation cache and history scope identity", () => {
    const source = page("DirectMessagePage.tsx");
    expect(source).toContain("DIRECT_CHAT_SCOPE.cachePrefix");
    expect(source).toContain("table: DIRECT_CHAT_SCOPE.messageTable");
    expect(source).toContain(
      "scope: buildChatScopeFilter(DIRECT_CHAT_SCOPE, conversationId)",
    );
    expect(source).not.toContain('["dm-messages", conversationId]');
  });

  it("uses the group adapter for message cache and history scope identity", () => {
    const source = page("GroupChatPage.tsx");
    expect(source).toContain("GROUP_CHAT_SCOPE.cachePrefix");
    expect(source).toContain("table: GROUP_CHAT_SCOPE.messageTable");
    expect(source).toContain(
      "scope: buildChatScopeFilter(GROUP_CHAT_SCOPE, groupId)",
    );
    expect(source).not.toContain('["group-messages", groupId]');
  });

  it("uses the club adapter for message cache and history scope identity", () => {
    const source = page("ClubChatPage.tsx");
    expect(source).toContain("CLUB_CHAT_SCOPE.cachePrefix");
    expect(source).toContain("table: CLUB_CHAT_SCOPE.messageTable");
    expect(source).toContain(
      "scope: buildChatScopeFilter(CLUB_CHAT_SCOPE, clubId)",
    );
    expect(source).not.toContain('["club-messages", clubId]');
  });

  it("uses the team adapter for message cache and history scope identity", () => {
    const source = page("TeamChatPage.tsx");
    expect(source).toContain("TEAM_CHAT_SCOPE.cachePrefix");
    expect(source).toContain("table: TEAM_CHAT_SCOPE.messageTable");
    expect(source).toContain(
      "scope: buildChatScopeFilter(TEAM_CHAT_SCOPE, teamId)",
    );
    expect(source).not.toContain('["team-messages", teamId]');
  });
});
