import { describe, it, expect } from "vitest";
import { makeTeamEventVisibility } from "@/lib/competitionViewerScope";

const masters = "comp-masters";
const other = "comp-other";
const events = [
  { id: "e1", team_id: "red", competition_id: masters, competition_match_id: "m1" },
  { id: "e2", team_id: "blue", competition_id: masters, competition_match_id: "m1" },
  { id: "e3", team_id: "green", competition_id: masters, competition_match_id: "m2" },
  { id: "e4", team_id: "pink", competition_id: masters, competition_match_id: "m2" },
];

describe("competition fixture visibility", () => {
  it("competition admin with no team sees every match once", () => {
    const vis = makeTeamEventVisibility([], [masters], events);
    expect(events.filter(vis).map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("regular team member sees only their own team's games", () => {
    const vis = makeTeamEventVisibility(["red"], [], events);
    expect(events.filter(vis).map((e) => e.id)).toEqual(["e1"]);
  });

  it("admin of a different competition sees no Masters games", () => {
    const vis = makeTeamEventVisibility([], [other], events);
    expect(events.filter(vis)).toHaveLength(0);
  });

  it("admin who is also on a team sees their own copy, not the opponent's", () => {
    const vis = makeTeamEventVisibility(["blue"], [masters], events);
    expect(events.filter(vis).map((e) => e.id)).toEqual(["e2", "e3"]);
  });
});

describe("fixture events without competition_id", () => {
  it("matches on competition match id", () => {
    const evs = [
      { id: "a", team_id: "red", competition_id: null, competition_match_id: "m9" },
      { id: "b", team_id: "blue", competition_id: null, competition_match_id: "m9" },
    ];
    expect(evs.filter(makeTeamEventVisibility([], ["m9"], evs)).map((e) => e.id)).toEqual(["a"]);
    expect(evs.filter(makeTeamEventVisibility([], ["other"], evs))).toHaveLength(0);
  });
});
