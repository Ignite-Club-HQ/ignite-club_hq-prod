import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { normaliseTestPlayer, testPlayersToPitchMembers } from "./testPlayers";
import { usePitchBoardRosterReconciliation } from "@/components/pitch/hooks/usePitchBoardRosterReconciliation";

const row = (id: string, name: string, shirt: number | null, positions: string[]) =>
  normaliseTestPlayer({ id, club_id: "c1", team_id: "t1", name, shirt_number: shirt == null ? [] : [shirt], positions, age_group: [] });

describe("test players", () => {
  it("maps shirt number and only known positions", () => {
    const [m] = testPlayersToPitchMembers([row("tp-1-9", "Rocket One", 7, ["MID", "WING"])]);
    expect(m).toMatchObject({ user_id: "tp-1-9", role: "player", jersey_number: 7, preferred_positions: ["MID"], is_test_player: true });
  });

  it("ignores rows that are not test player ids", () => {
    expect(testPlayersToPitchMembers([row("child-1", "Real", 1, [])])).toHaveLength(0);
  });

  it("keeps test players on a linked match board even though they cannot RSVP", () => {
    const members = [
      { user_id: "acct-going", role: "player", profiles: { display_name: "Going" } },
      { user_id: "acct-out", role: "player", profiles: { display_name: "Out" } },
      ...testPlayersToPitchMembers([row("tp-2-9", "Striker Two", 9, ["FWD"])]),
    ];
    const { result } = renderHook(() => usePitchBoardRosterReconciliation({
      members, teamPlayerPositions: [], goingAttendeeIds: new Set(["acct-going"]),
      linkedEventId: "e1", initialLinkedEventId: "e1", savedState: null,
    } as any));
    const ids = result.current.realPlayers.map((p: any) => p.id);
    expect(ids).toEqual(["acct-going", "tp-2-9"]);
    expect(result.current.realPlayers[1]).toMatchObject({ number: 9, assignedPositions: ["FWD"] });
  });
});
