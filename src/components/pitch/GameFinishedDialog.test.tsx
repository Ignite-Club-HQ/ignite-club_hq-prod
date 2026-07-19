import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import GameFinishedDialog from "./GameFinishedDialog";

// Deferred resolvers so we can simulate the async gap between the first
// click and `isSaving` flipping true.
let saveGameStatsMock: ReturnType<typeof vi.fn>;
let saveGameResultMock: ReturnType<typeof vi.fn>;
let resolveSaveStats: (v?: unknown) => void;
let resolveSaveResult: (v?: unknown) => void;

vi.mock("@/hooks/useGameStats", () => ({
  useGameStats: () => ({
    saveGameStats: saveGameStatsMock,
    isSaving: false,
  }),
}));

vi.mock("@/hooks/useSaveGameResult", () => ({
  useSaveGameResult: () => ({
    save: saveGameResultMock,
  }),
}));

const players = [
  { id: "p1", name: "Alice", position: null, minutesPlayed: 30 },
  { id: "p2", name: "Bob", position: null, minutesPlayed: 25 },
];

const baseProps = {
  open: true,
  onClose: vi.fn(),
  players,
  totalGameTime: 60,
  teamName: "Test Team",
  linkedEventId: "event-1",
  teamId: "team-1",
  formationUsed: "2-3-1",
  teamSize: 7,
  executedSubs: [],
  halfDuration: 30,
  goals: [],
  eventTitle: "Match",
  eventDate: "2026-01-01",
  opponent: "Opponent FC",
};

describe("GameFinishedDialog duplicate submission guard", () => {
  beforeEach(() => {
    localStorage.clear();
    saveGameStatsMock = vi.fn(
      () => new Promise((r) => { resolveSaveStats = r; }),
    );
    saveGameResultMock = vi.fn(
      () => new Promise((r) => { resolveSaveResult = r; }),
    );
    baseProps.onClose = vi.fn();
  });

  it("submits completion only once when the finish button is clicked repeatedly", async () => {
    render(<GameFinishedDialog {...baseProps} />);
    const button = screen.getByRole("button", { name: /Save & Finish/i });

    // Rapid successive clicks before any async state can update.
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    // Button becomes disabled immediately after the first click.
    expect(button).toBeDisabled();

    // Resolve the pending saves.
    await act(async () => {
      resolveSaveStats(undefined);
      resolveSaveResult(undefined);
    });

    await waitFor(() => {
      expect(saveGameStatsMock).toHaveBeenCalledTimes(1);
    });
    expect(saveGameResultMock).toHaveBeenCalledTimes(1);
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("saveGameStats is called once", async () => {
    render(<GameFinishedDialog {...baseProps} />);
    const button = screen.getByRole("button", { name: /Save & Finish/i });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => {
      resolveSaveStats(undefined);
      resolveSaveResult(undefined);
    });
    await waitFor(() => expect(saveGameStatsMock).toHaveBeenCalledTimes(1));
  });

  it("saveGameResult is called once", async () => {
    render(<GameFinishedDialog {...baseProps} />);
    const button = screen.getByRole("button", { name: /Save & Finish/i });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => {
      resolveSaveStats(undefined);
      resolveSaveResult(undefined);
    });
    await waitFor(() => expect(saveGameResultMock).toHaveBeenCalledTimes(1));
  });

  it("onClose is called once", async () => {
    render(<GameFinishedDialog {...baseProps} />);
    const button = screen.getByRole("button", { name: /Save & Finish/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => {
      resolveSaveStats(undefined);
      resolveSaveResult(undefined);
    });
    await waitFor(() => expect(baseProps.onClose).toHaveBeenCalledTimes(1));
  });

  it("the completion button becomes disabled immediately after the first click", () => {
    render(<GameFinishedDialog {...baseProps} />);
    const button = screen.getByRole("button", { name: /Save & Finish/i });
    fireEvent.click(button);
    expect(button).toBeDisabled();
  });

  it("still saves stats and result for a linked game (happy path)", async () => {
    render(<GameFinishedDialog {...baseProps} />);
    const button = screen.getByRole("button", { name: /Save & Finish/i });
    fireEvent.click(button);
    await act(async () => {
      resolveSaveStats(undefined);
      resolveSaveResult(undefined);
    });
    await waitFor(() => {
      expect(saveGameStatsMock).toHaveBeenCalledTimes(1);
      expect(saveGameResultMock).toHaveBeenCalledTimes(1);
      expect(baseProps.onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("unlinked game performs local completion once without remote saves", async () => {
    render(<GameFinishedDialog {...baseProps} linkedEventId={null} />);
    const button = screen.getByRole("button", { name: /Done/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(baseProps.onClose).toHaveBeenCalledTimes(1));
    expect(saveGameStatsMock).not.toHaveBeenCalled();
    expect(saveGameResultMock).not.toHaveBeenCalled();
  });

  it("stats and result failures do not prevent local cleanup or closing", async () => {
    saveGameStatsMock = vi.fn().mockRejectedValue(new Error("stats fail"));
    saveGameResultMock = vi.fn().mockRejectedValue(new Error("result fail"));
    render(<GameFinishedDialog {...baseProps} />);
    const button = screen.getByRole("button", { name: /Save & Finish/i });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(baseProps.onClose).toHaveBeenCalledTimes(1));
    expect(saveGameStatsMock).toHaveBeenCalledTimes(1);
    expect(saveGameResultMock).toHaveBeenCalledTimes(1);
  });

  it("stamps timer state as finished with gameFinishedAt", async () => {
    const timerKey = "pitch-board-timer-state-team-team-1";
    localStorage.setItem(
      timerKey,
      JSON.stringify({ isRunning: true, lastUpdateTime: 1 }),
    );
    render(<GameFinishedDialog {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Save & Finish/i }));
    await act(async () => {
      resolveSaveStats(undefined);
      resolveSaveResult(undefined);
    });
    await waitFor(() => expect(baseProps.onClose).toHaveBeenCalledTimes(1));
    const stamped = JSON.parse(localStorage.getItem(timerKey)!);
    expect(stamped.isGameFinished).toBe(true);
    expect(stamped.isRunning).toBe(false);
    expect(stamped.gameFinishedAt).toBeGreaterThan(0);
  });

  it("clears autoSubPlan and linked event from pitch state", async () => {
    const pitchKey = "ignite-pitch-board-state-team-team-1";
    localStorage.setItem(
      pitchKey,
      JSON.stringify({
        autoSubPlan: [{ x: 1 }],
        autoSubActive: true,
        autoSubPaused: true,
        linkedEventId: "event-1",
        players: [
          { id: "p1", isFillIn: false },
          { id: "p9", isFillIn: true },
        ],
      }),
    );
    render(<GameFinishedDialog {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Save & Finish/i }));
    await act(async () => {
      resolveSaveStats(undefined);
      resolveSaveResult(undefined);
    });
    await waitFor(() => expect(baseProps.onClose).toHaveBeenCalledTimes(1));
    const state = JSON.parse(localStorage.getItem(pitchKey)!);
    expect(state.autoSubPlan).toEqual([]);
    expect(state.autoSubActive).toBe(false);
    expect(state.autoSubPaused).toBe(false);
    expect(state.linkedEventId).toBeNull();
    expect(state.players.map((p: any) => p.id)).toEqual(["p1"]);
  });

  it("guard blocks a synchronous double-click before React re-renders", async () => {
    render(<GameFinishedDialog {...baseProps} />);
    const button = screen.getByRole("button", { name: /Save & Finish/i });
    // Two clicks dispatched in the same microtask
    fireEvent.click(button);
    fireEvent.click(button);
    // saveGameStats has already been invoked exactly once, synchronously
    expect(saveGameStatsMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSaveStats(undefined);
      resolveSaveResult(undefined);
    });
    await waitFor(() => expect(baseProps.onClose).toHaveBeenCalledTimes(1));
  });
});
