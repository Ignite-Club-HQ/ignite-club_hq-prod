import { describe, expect, it } from "vitest";
import {
  resolveInviteJoinCompletion,
  selectNewInviteRoles,
  validateReusableTeamInvite,
} from "./inviteAcceptancePolicy";

describe("invite acceptance policy", () => {
  it("adds only roles not already held at the exact destination", () => {
    expect(selectNewInviteRoles(
      ["coach", "parent", "player"],
      ["parent", "team_admin"],
    )).toEqual(["coach", "player"]);
  });

  it("accepts an unexpired reusable link below its usage limit", () => {
    expect(() => validateReusableTeamInvite({
      expiresAt: "2026-09-01T00:00:00Z",
      maxUses: 5,
      usesCount: 4,
      now: new Date("2026-08-13T00:00:00Z"),
    })).not.toThrow();
  });

  it("rejects expired and exhausted reusable links with existing messages", () => {
    expect(() => validateReusableTeamInvite({
      expiresAt: "2026-08-12T00:00:00Z",
      usesCount: 0,
      now: new Date("2026-08-13T00:00:00Z"),
    })).toThrow("This invite link has expired");
    expect(() => validateReusableTeamInvite({
      maxUses: 2,
      usesCount: 2,
    })).toThrow("This invite link has reached its usage limit");
  });

  it("opens child setup only for the current eligible parent flows", () => {
    expect(resolveInviteJoinCompletion({
      isPendingInvite: false,
      addedRoles: ["parent"],
      regularInviteHasMetadata: false,
    })).toBe("add-child");
    expect(resolveInviteJoinCompletion({
      isPendingInvite: false,
      addedRoles: ["parent"],
      regularInviteHasMetadata: true,
    })).toBe("joined");
    expect(resolveInviteJoinCompletion({
      isPendingInvite: true,
      addedRoles: ["parent"],
      regularInviteHasMetadata: false,
      pendingInviteKind: "mini_league_parent_join_link",
    })).toBe("add-child");
    expect(resolveInviteJoinCompletion({
      isPendingInvite: true,
      addedRoles: ["coach"],
      regularInviteHasMetadata: false,
      pendingInviteKind: "mini_league_parent_join_link",
    })).toBe("joined");
  });

  it("records the existing photo-consent continuation distinction explicitly", () => {
    expect(resolveInviteJoinCompletion({
      isPendingInvite: true,
      addedRoles: ["parent"],
      regularInviteHasMetadata: false,
      pendingInviteKind: "mini_league_parent_join_link",
      completedAfterPhotoConsent: true,
    })).toBe("joined");
  });
});
