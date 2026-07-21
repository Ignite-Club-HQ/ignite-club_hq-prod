import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveGameStats, saveGameResult, hookState } = vi.hoisted(() => ({
  saveGameStats: vi.fn(), saveGameResult: vi.fn(), hookState: { isSaving: false },
}));
vi.mock("@/hooks/useGameStats", () => ({ useGameStats: () => ({ saveGameStats, isSaving: hookState.isSaving }) }));
vi.mock("@/hooks/useSaveGameResult", () => ({ useSaveGameResult: () => ({ save: saveGameResult }) }));

import GameFinishedDialog from "./GameFinishedDialog";

const players = [
  { id: "player-1", name: "Alex", position: null, minutesPlayed: 2400 },
  { id: "fill-in-1", name: "Guest", position: null, minutesPlayed: 1200, isFillIn: true },
];
const goals = [
  { id: "g1", scorerId: "player-1", scorerName: "Alex", time: 300, half: 1 as const, isOpponentGoal: false },
  { id: "g2", scorerId: "player-1", scorerName: "Alex", time: 900, half: 1 as const, isOpponentGoal: false },
  { id: "g3", time: 1500, half: 2 as const, isOpponentGoal: true },
];

function renderDialog(overrides: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  render(<GameFinishedDialog
    open onClose={onClose} players={players} totalGameTime={3600} teamName="Riverside"
    linkedEventId="event-1" teamId="team-1" formationUsed="4-4-2" teamSize={11}
    executedSubs={[]} halfDuration={1800} goals={goals} eventTitle="League Match"
    eventDate="2026-08-01" opponent="United" {...overrides}
  />);
  return onClose;
}

describe("GameFinishedDialog completion workflow", () => {
  beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks(); hookState.isSaving = false;
    saveGameStats.mockResolvedValue(undefined); saveGameResult.mockResolvedValue(undefined);
  });

  it("persists linked game stats and a non-clobbering soccer result before closing", async () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save & Finish" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());

    expect(saveGameStats).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1", teamId: "team-1", players, totalGameTime: 3600,
      halfDuration: 1800, formationUsed: "4-4-2", teamSize: 11, goals,
    }));
    expect(saveGameResult).toHaveBeenCalledWith({
      teamId: "team-1", eventId: "event-1", sport: "soccer", homeLabel: "Riverside", awayLabel: "United",
      homeScore: 2, awayScore: 1, perQuarter: [], players: [{ id: "player-1", name: "Alex", goals: 2 }],
    }, { silent: true, onlyIfMissing: true });
  });

  it("does not persist stats or results for an unlinked game", async () => {
    const onClose = renderDialog({ linkedEventId: null });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(saveGameStats).not.toHaveBeenCalled(); expect(saveGameResult).not.toHaveBeenCalled();
  });

  it("continues local cleanup and closes when stats and result persistence fail", async () => {
    saveGameStats.mockRejectedValue(new Error("stats denied"));
    saveGameResult.mockRejectedValue(new Error("result denied"));
    localStorage.setItem("ignite-pitch-board-state-team-team-1", JSON.stringify({
      teamId: "team-1", linkedEventId: "event-1", autoSubPlan: [{ id: "step" }], autoSubActive: true,
      autoSubPaused: true, players,
    }));
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save & Finish" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const state = JSON.parse(localStorage.getItem("ignite-pitch-board-state-team-team-1")!);
    expect(state).toMatchObject({ linkedEventId: null, autoSubPlan: [], autoSubActive: false, autoSubPaused: false });
    expect(state.players).toEqual([expect.objectContaining({ id: "player-1" })]);
  });

  it("stamps only the matching team's timer as finished", async () => {
    localStorage.setItem("pitch-board-timer-state-team-team-1", JSON.stringify({ isRunning: true }));
    localStorage.setItem("pitch-board-timer-state", JSON.stringify({ teamId: "other-team", isRunning: true }));
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save & Finish" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(JSON.parse(localStorage.getItem("pitch-board-timer-state-team-team-1")!)).toMatchObject({ isGameFinished: true, isRunning: false });
    expect(JSON.parse(localStorage.getItem("pitch-board-timer-state")!)).toEqual({ teamId: "other-team", isRunning: true });
  });

  it("preserves an existing finish timestamp while refreshing last-update time", async () => {
    localStorage.setItem("pitch-board-timer-state-team-team-1", JSON.stringify({ isRunning: true, gameFinishedAt: 123 }));
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save & Finish" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const timer = JSON.parse(localStorage.getItem("pitch-board-timer-state-team-team-1")!);
    expect(timer.gameFinishedAt).toBe(123);
    expect(timer.lastUpdateTime).toEqual(expect.any(Number));
  });

  it("disables completion while stats are already saving", () => {
    hookState.isSaving = true;
    renderDialog();
    expect(screen.getByRole("button", { name: "Saving Stats..." })).toBeDisabled();
  });

  it("submits completion only once when the finish button is clicked repeatedly", async () => {
    let releaseSave!: () => void;
    saveGameStats.mockImplementation(
      () => new Promise<void>((resolve) => { releaseSave = resolve; }),
    );
    const onClose = renderDialog();
    const finish = screen.getByRole("button", { name: "Save & Finish" });

    fireEvent.click(finish);
    fireEvent.click(finish);
    expect(saveGameStats).toHaveBeenCalledTimes(1);

    releaseSave();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(saveGameResult).toHaveBeenCalledTimes(1);
  });

  it("removes match-only fill-ins while preserving registered players after completion", async () => {
    localStorage.setItem("ignite-pitch-board-state-team-team-1", JSON.stringify({
      teamId: "team-1",
      linkedEventId: "event-1",
      players,
      goals,
      score: { home: 2, away: 1 },
    }));
    const onClose = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Save & Finish" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());

    const state = JSON.parse(
      localStorage.getItem("ignite-pitch-board-state-team-team-1")!,
    );
    expect(state.players).toEqual([
      expect.objectContaining({ id: "player-1", name: "Alex" }),
    ]);
    expect(state.goals).toEqual(goals);
    expect(state.score).toEqual({ home: 2, away: 1 });
  });

  it("counts opponent goals in the away score and excludes unattributed team goals from player tallies", async () => {
    const mixedGoals = [
      ...goals,
      { id: "g4", time: 1700, half: 2 as const, isOpponentGoal: false },
      { id: "g5", scorerId: "player-2", time: 1800, half: 2 as const, isOpponentGoal: true },
    ];
    const onClose = renderDialog({ goals: mixedGoals });

    fireEvent.click(screen.getByRole("button", { name: "Save & Finish" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());

    expect(saveGameResult).toHaveBeenCalledWith(
      expect.objectContaining({
        homeScore: 3,
        awayScore: 2,
        players: [{ id: "player-1", name: "Alex", goals: 2 }],
      }),
      { silent: true, onlyIfMissing: true },
    );
  });

  it("still closes safely when persisted timer and pitch state are malformed", async () => {
    localStorage.setItem("pitch-board-timer-state-team-team-1", "{invalid");
    localStorage.setItem("pitch-board-timer-state", "{invalid");
    localStorage.setItem("ignite-pitch-board-state-team-team-1", "{invalid");
    const onClose = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Save & Finish" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());

    expect(localStorage.getItem("pitch-board-timer-state-team-team-1")).toBe("{invalid");
    expect(localStorage.getItem("ignite-pitch-board-state-team-team-1")).toBe("{invalid");
  });
});
