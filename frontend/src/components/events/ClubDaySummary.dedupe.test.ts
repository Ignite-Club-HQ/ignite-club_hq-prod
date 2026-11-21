import { describe, it, expect } from "vitest";
import { dedupeMirroredGames } from "./ClubDaySummary";
const g = (team_name: string, opponent: string, start_time = "10:00") => ({ type: "game", event_date: "2026-11-18", start_time, team_name, opponent });
describe("dedupeMirroredGames", () => {
  it("lists a match between two club teams once", () => {
    expect(dedupeMirroredGames([g("Dark Horses", "Mint Condition"), g("Mint Condition", "Dark Horses")])).toHaveLength(1);
  });
  it("keeps rematches at different times", () => {
    expect(dedupeMirroredGames([g("A", "B", "10:00"), g("B", "A", "12:00")])).toHaveLength(2);
  });
});
