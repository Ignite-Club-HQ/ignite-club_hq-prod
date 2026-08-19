import { describe, expect, it } from "vitest";
import {
  resolveEventTeamTargeting,
  shouldClearEventTeamTargets,
  supportsClubWideEventScope,
} from "./eventTeamTargetingPolicy";

describe("event team targeting policy", () => {
  it.each(["training", "game", "social"])("allows %s to be club-wide", (eventType) => {
    expect(supportsClubWideEventScope(eventType)).toBe(true);
    expect(resolveEventTeamTargeting({ eventType, teamId: null, targetTeamIds: null })).toEqual({
      valid: true,
      scope: "all_club",
      targetTeamIds: null,
      rsvpGrouping: null,
    });
  });

  it("persists a single-team training through team_id and clears stale club targets", () => {
    expect(resolveEventTeamTargeting({
      eventType: "training",
      teamId: "team-a",
      targetTeamIds: ["team-b", "team-c"],
      rsvpGrouping: "team",
    })).toEqual({
      valid: true,
      scope: "single_team",
      targetTeamIds: null,
      rsvpGrouping: null,
    });
  });

  it("persists a multi-team training as a club-wide event with target_team_ids", () => {
    expect(resolveEventTeamTargeting({
      eventType: "training",
      teamId: null,
      targetTeamIds: ["team-a", "team-b", "team-c"],
      rsvpGrouping: "team",
    })).toEqual({
      valid: true,
      scope: "multiple_teams",
      targetTeamIds: ["team-a", "team-b", "team-c"],
      rsvpGrouping: "team",
    });
  });

  it.each([[[]], [["team-a"]], [["team-a", "team-a"]], [["", "team-a"]]])(
    "rejects a selected subset with fewer than two distinct teams: %j",
    (targetTeamIds) => {
      expect(resolveEventTeamTargeting({
        eventType: "training",
        teamId: null,
        targetTeamIds,
      })).toEqual({ valid: false, reason: "too_few_distinct_teams" });
    },
  );

  it("deduplicates and trims targets before persistence without mutating form state", () => {
    const targetTeamIds = Object.freeze([" team-a ", "team-b", "team-a"]);
    const result = resolveEventTeamTargeting({
      eventType: "training",
      teamId: null,
      targetTeamIds,
    });
    expect(result).toMatchObject({ targetTeamIds: ["team-a", "team-b"] });
    expect(targetTeamIds).toEqual([" team-a ", "team-b", "team-a"]);
  });

  it("preserves RSVP grouping for all-club and multi-team training", () => {
    for (const targetTeamIds of [null, ["team-a", "team-b"]] as const) {
      expect(resolveEventTeamTargeting({
        eventType: "training",
        targetTeamIds,
        rsvpGrouping: "level",
      })).toMatchObject({ rsvpGrouping: "level" });
    }
  });

  it("clears targets when switching to one team or an unsupported event type", () => {
    expect(shouldClearEventTeamTargets("training", "team-a")).toBe(true);
    expect(shouldClearEventTeamTargets("mini_league", null)).toBe(true);
    expect(shouldClearEventTeamTargets("training", null)).toBe(false);
  });
});
