import { describe, expect, it, vi } from "vitest";
vi.mock("./features/messaging", () => ({ addLiveGroupMembers: vi.fn(), ensureLiveStandardClubChat: vi.fn(), listLiveGroupsByClub: vi.fn() }));
vi.mock("./messagingCandidates", () => ({ fetchLiveMessagingCandidates: vi.fn() }));
import { hasSyncedDefaultClubChats, markDefaultClubChatsSyncedForTest } from "./defaultClubChats";
import { afterMembershipAcknowledgement, clearRoleGrantsMemo } from "./roleGrantsMemo";

describe("staff chat resync after role changes", () => {
  it("forgets completed staff chat sync when a role change is acknowledged", async () => {
    markDefaultClubChatsSyncedForTest("club-a");
    await afterMembershipAcknowledgement(Promise.resolve("ok"));
    expect(hasSyncedDefaultClubChats("club-a")).toBe(false);
  });
  it("forgets completed staff chat sync when role grants are cleared", () => {
    markDefaultClubChatsSyncedForTest("club-b");
    clearRoleGrantsMemo();
    expect(hasSyncedDefaultClubChats("club-b")).toBe(false);
  });
  it("keeps sync state when the role change was rejected", async () => {
    markDefaultClubChatsSyncedForTest("club-c");
    await expect(afterMembershipAcknowledgement(Promise.reject(new Error("denied")))).rejects.toThrow();
    expect(hasSyncedDefaultClubChats("club-c")).toBe(true);
  });
});
