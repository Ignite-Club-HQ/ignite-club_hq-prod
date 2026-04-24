import { describe, expect, it } from "vitest";

import { applyTeamPlayersToObjects } from "./teamPlayerSubstitution";
import type { DrillObject } from "./types";

const SERVER = "#22c55e";

function player(id: string, label: string, x: number, y: number): DrillObject {
  return { id, type: "player", label, x, y, color: SERVER };
}

describe("applyTeamPlayersToObjects", () => {
  it("moves the real player into whichever authored slot is currently active", () => {
    const players = [{ id: "louie", name: "Louie" }];

    const frameOne = applyTeamPlayersToObjects(
      [player("s1", "S1", 30, 70), player("s2", "S2", 15, 90)],
      players
    );
    const frameTwo = applyTeamPlayersToObjects(
      [player("s1", "S1", 15, 90), player("s2", "S2", 30, 70)],
      players
    );

    expect(frameOne).toEqual([
      expect.objectContaining({ id: "s1", label: "Louie", x: 30, y: 70 }),
    ]);
    expect(frameTwo).toEqual([
      expect.objectContaining({ id: "s2", label: "Louie", x: 30, y: 70 }),
    ]);
  });
});