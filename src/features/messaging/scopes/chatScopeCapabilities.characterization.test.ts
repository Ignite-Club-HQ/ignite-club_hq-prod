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
});
