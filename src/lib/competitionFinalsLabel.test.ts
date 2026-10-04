import { describe, expect, it } from "vitest";
import { getCompetitionFinalsLabel } from "./competitionFinalsLabel";

describe("competition finals labels", () => {
  it.each(["Finals", "Semi Final", "Semi-finals", "Grand Final", "Finals 1"])("preserves %s", (label) => {
    expect(getCompetitionFinalsLabel(label)).toBe(label);
  });
  it("recognises generated finals without displaying seed notes", () => {
    expect(getCompetitionFinalsLabel("Grand Final · 1 v 2")).toBe("Grand Final");
  });
  it.each([null, "", "Round 1", "12", "Bring water"])("does not label ordinary matches: %s", (label) => {
    expect(getCompetitionFinalsLabel(label)).toBeNull();
  });
});