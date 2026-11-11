import { describe, expect, it } from "vitest";
import { breakdownFromServerSummary } from "./vaultStorageRepository";

describe("server storage summary", () => {
  it("counts every club file, including older ones, per team", () => {
    const b = breakdownFromServerSummary([
      { team_id: null, mini_league_id: null, is_image: true, bytes: "230393440" },
      { team_id: "t1", mini_league_id: null, is_image: false, bytes: 1000 },
    ], [{ id: "t1", name: "U12" }], []);
    expect(b.total).toBe(230394440);
    expect(b.photos).toBe(230393440);
    expect(b.documents).toBe(1000);
    expect(b.byTeam.find((t) => t.teamId === "t1")?.size).toBe(1000);
  });
});
