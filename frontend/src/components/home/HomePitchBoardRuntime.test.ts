import { createElement } from "react";
import { render, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeGameTimerRuntime, resolveHomeGameTimerAccess } from "./HomePitchBoardRuntime";

vi.mock("@/components/pitch/GameTimerWidget", () => ({
  default: ({ onOpenPitchBoard }: { onOpenPitchBoard: (team: string, name: string, event: string) => void }) =>
    createElement("button", { onClick: () => onOpenPitchBoard("team-1", "Ignite", "actual-widget-event") }, "Open test board"),
}));

const teams = [{ id: "team-1", name: "Ignite", club_id: "club-1" }];

describe("resolveHomeGameTimerAccess", () => {
  afterEach(() => localStorage.clear());

  it("forwards the widget's displayed match rather than a stale active-timer match", async () => {
    localStorage.setItem("pitch-board-timer-state", JSON.stringify({ teamId: "team-1", eventId: "old-event" }));
    const onOpenPitchBoard = vi.fn();
    const screen = render(createElement(HomeGameTimerRuntime, {
      userRoles: [{ role: "coach", team_id: "team-1" }],
      isAppAdmin: false, editableTeams: teams, readOnlyTeams: [], onOpenPitchBoard,
    }));
    fireEvent.click(await screen.findByRole("button", { name: "Open test board" }));
    expect(onOpenPitchBoard).toHaveBeenCalledWith("team-1", "Ignite", false, "actual-widget-event");
  });
  it("allows team members to view but only managers to edit", () => {
    expect(
      resolveHomeGameTimerAccess({
        timerTeamId: "team-1",
        userRoles: [{ role: "player", team_id: "team-1" }],
        isAppAdmin: false,
        editableTeams: teams,
        readOnlyTeams: [],
      }),
    ).toEqual({ canView: true, canEdit: false });
    expect(
      resolveHomeGameTimerAccess({
        timerTeamId: "team-1",
        userRoles: [{ role: "coach", team_id: "team-1" }],
        isAppAdmin: false,
        editableTeams: teams,
        readOnlyTeams: [],
      }),
    ).toEqual({ canView: true, canEdit: true });
  });

  it("allows the owning club admin and rejects unrelated users", () => {
    expect(
      resolveHomeGameTimerAccess({
        timerTeamId: "team-1",
        userRoles: [{ role: "club_admin", club_id: "club-1" }],
        isAppAdmin: false,
        editableTeams: teams,
        readOnlyTeams: [],
      }),
    ).toEqual({ canView: true, canEdit: true });
    expect(
      resolveHomeGameTimerAccess({
        timerTeamId: "team-1",
        userRoles: [{ role: "player", team_id: "team-2" }],
        isAppAdmin: false,
        editableTeams: teams,
        readOnlyTeams: [],
      }),
    ).toEqual({ canView: false, canEdit: false });
  });
});
