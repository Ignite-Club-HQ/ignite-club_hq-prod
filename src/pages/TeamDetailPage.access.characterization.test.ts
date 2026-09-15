import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/pitch/PitchBoard", () => ({ default: () => null }));

import {
  resolveTeamCardParentIds,
  resolveTeamDetailAccess,
  resolveTeamDetailEntitlements,
} from "./TeamDetailPage";

describe("TeamDetailPage child-card parent scope", () => {
  it("shows Paul with Teddy in Club A without leaking Tessa's Club B guardian relationship", () => {
    expect(resolveTeamCardParentIds({
      candidateParentIds: ["paul", "tessa"],
      memberships: [
        { user_id: "paul", team_id: "club-a-team", club_id: "club-a" },
        { user_id: "tessa", team_id: "club-b-team", club_id: "club-b" },
      ],
      teamId: "club-a-team",
      clubId: "club-a",
    })).toEqual(["paul"]);
  });

  it("still shows a guardian who belongs to another team in the same club", () => {
    expect(resolveTeamCardParentIds({
      candidateParentIds: ["same-club-guardian"],
      memberships: [{ user_id: "same-club-guardian", team_id: "other-team", club_id: "club-a" }],
      teamId: "club-a-team",
      clubId: "club-a",
    })).toEqual(["same-club-guardian"]);
  });
});

describe("TeamDetailPage access characterization", () => {
  it.each(["team_admin", "coach"])("gives a %s full team and pitch management", (role) => {
    expect(resolveTeamDetailAccess([role], false, false)).toEqual(expect.objectContaining({
      userRole: role,
      isCoachOrAdmin: true,
      canManageTeam: true,
      isMember: true,
      canAccessPitchBoard: true,
      canEditPitchBoard: true,
    }));
  });

  it("prioritises team_admin when a user has several team roles", () => {
    expect(resolveTeamDetailAccess(["player", "coach", "team_admin"], false, false).userRole).toBe("team_admin");
  });

  it.each(["player", "parent"])("gives a %s read-only pitch access", (role) => {
    expect(resolveTeamDetailAccess([role], false, false)).toEqual(expect.objectContaining({
      canManageTeam: false,
      isMember: true,
      canAccessPitchBoard: true,
      canEditPitchBoard: false,
    }));
  });

  it("gives the team's club administrator implicit membership and management", () => {
    expect(resolveTeamDetailAccess([], false, true)).toEqual(expect.objectContaining({
      canManageTeam: true,
      isMember: true,
      canAccessPitchBoard: true,
      canEditPitchBoard: true,
    }));
  });

  it("gives an app administrator implicit membership and management", () => {
    expect(resolveTeamDetailAccess([], true, false)).toEqual(expect.objectContaining({
      canManageTeam: true,
      isMember: true,
      canAccessPitchBoard: true,
      canEditPitchBoard: true,
    }));
  });

  it("lets a temporary Subs Manager edit the pitch without granting team management", () => {
    expect(resolveTeamDetailAccess([], false, false, true)).toEqual(expect.objectContaining({
      canManageTeam: false,
      isMember: false,
      canAccessPitchBoard: false,
      canEditPitchBoard: true,
    }));
  });

  it("gives an unrelated user no team or pitch access", () => {
    expect(resolveTeamDetailAccess([], false, false)).toEqual(expect.objectContaining({
      canManageTeam: false,
      isMember: false,
      canAccessPitchBoard: false,
      canEditPitchBoard: false,
    }));
  });
});

describe("TeamDetailPage entitlement characterization", () => {
  it("inherits ordinary and football Pro from the club", () => {
    expect(resolveTeamDetailEntitlements({}, null, { is_pro_football: true }, false)).toEqual(expect.objectContaining({
      isTeamPro: true,
      hasProFootball: true,
    }));
  });

  it("allows an individual team subscription in a free club", () => {
    expect(resolveTeamDetailEntitlements({}, { is_pro: true }, { is_pro: false }, false)).toEqual(expect.objectContaining({
      isTeamPro: true,
      hasProFootball: false,
    }));
  });

  it("does not treat ordinary team Pro as football Pro", () => {
    expect(resolveTeamDetailEntitlements({}, { is_pro: true }, null, false)).toEqual(expect.objectContaining({
      isTeamPro: true,
      hasProFootball: false,
    }));
  });

  it("honours club and team administrative overrides", () => {
    expect(resolveTeamDetailEntitlements({}, null, { admin_pro_override: true }, false).isTeamPro).toBe(true);
    expect(resolveTeamDetailEntitlements({}, { admin_pro_football_override: true }, null, false).hasProFootball).toBe(true);
  });

  it("stays optimistically unlocked while subscription state is loading", () => {
    expect(resolveTeamDetailEntitlements({}, null, null, true)).toEqual(expect.objectContaining({
      isTeamPro: true,
      hasProFootball: true,
    }));
  });

  it("locks both entitlement types after a confirmed free result", () => {
    expect(resolveTeamDetailEntitlements({}, null, null, false)).toEqual(expect.objectContaining({
      isTeamPro: false,
      hasProFootball: false,
    }));
  });

  it("recognises subscription and website-signup trials", () => {
    expect(resolveTeamDetailEntitlements({}, { is_trial: true }, null, false).isOnTrial).toBe(true);
    expect(resolveTeamDetailEntitlements({ is_pro: true, pro_expires_at: "2099-01-01T00:00:00Z" }, null, null, false).isOnTrial).toBe(true);
  });

  it("does not call permanent Pro access a trial", () => {
    expect(resolveTeamDetailEntitlements({ is_pro: true, pro_expires_at: null }, null, null, false).isOnTrial).toBe(false);
  });
});
