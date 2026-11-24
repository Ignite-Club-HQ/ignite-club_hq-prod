import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHomePitchBoard } from "./useHomePitchBoard";

vi.mock("@/components/pitch/PitchBoard", () => ({ default: () => null }));

function setup(overrides: Partial<Parameters<typeof useHomePitchBoard>[0]> = {}) {
  const args: Parameters<typeof useHomePitchBoard>[0] = {
    isAppAdmin: false,
    notifyProRequired: vi.fn(),
    hasProFootballAccess: vi.fn().mockResolvedValue(true),
    loadRoster: vi.fn().mockResolvedValue({
      members: [
        {
          id: "staff-role",
          user_id: "staff",
          role: "coach",
          profiles: { display_name: "Coach", avatar_url: null },
        },
        {
          id: "player-role",
          user_id: "adult-player",
          role: "player",
          profiles: { display_name: "Adult", avatar_url: null },
        },
      ],
      children: [
        { child_id: "child-going", child_name: "Going Child" },
        { child_id: "child-away", child_name: "Away Child" },
      ],
    }),
    findNearbyEvent: vi.fn().mockResolvedValue("event-1"),
    loadGoingRsvps: vi.fn().mockResolvedValue([
      { user_id: "adult-player", child_id: null },
      { user_id: null, child_id: "child-going" },
    ]),
    ...overrides,
  };
  return { args, ...renderHook(() => useHomePitchBoard(args)) };
}

describe("useHomePitchBoard", () => {
  afterEach(() => localStorage.clear());

  it("blocks non-admin users without Pro Football access", async () => {
    const notifyProRequired = vi.fn();
    const loadRoster = vi.fn();
    const { result } = setup({
      hasProFootballAccess: vi.fn().mockResolvedValue(false),
      notifyProRequired,
      loadRoster,
    });

    await act(() => result.current.openPitchBoard("team-1", "Ignite"));
    expect(notifyProRequired).toHaveBeenCalledOnce();
    expect(loadRoster).not.toHaveBeenCalled();
    expect(result.current.pitchBoardTeam).toBeNull();
    expect(result.current.pitchBoardLoading).toBe(false);
  });

  it("keeps staff and RSVP-going players while filtering the match roster", async () => {
    const { result } = setup();
    await act(() =>
      result.current.openPitchBoard("team-1", "Ignite", true),
    );

    expect(result.current.pitchBoardTeam).toMatchObject({
      id: "team-1",
      name: "Ignite",
      readOnly: true,
      linkedEventId: "event-1",
    });
    expect(
      result.current.pitchBoardTeam?.members.map((member) => member.user_id),
    ).toEqual(["staff", "adult-player", "child-going"]);
  });

  it("opens from the persisted timer event", async () => {
    localStorage.setItem(
      "pitch-board-timer-state",
      JSON.stringify({ teamId: "team-2", teamName: "Timer Team" }),
    );
    const findNearbyEvent = vi.fn().mockResolvedValue(null);
    const { result } = setup({ findNearbyEvent });

    act(() => window.dispatchEvent(new Event("open-pitch-board")));
    await waitFor(() =>
      expect(result.current.pitchBoardTeam?.id).toBe("team-2"),
    );
    expect(result.current.pitchBoardTeam?.name).toBe("Timer Team");
  });

  it("retries a failed load and opens on a later attempt", async () => {
    const loadRoster = vi
      .fn()
      .mockRejectedValueOnce(new Error("stalled"))
      .mockResolvedValue({ members: [], children: [] });
    const { result } = setup({
      loadRoster,
      findNearbyEvent: vi.fn().mockResolvedValue(null),
    });

    await act(() => result.current.openPitchBoard("team-1", "Ignite"));

    expect(loadRoster).toHaveBeenCalledTimes(2);
    expect(result.current.pitchBoardTeam?.id).toBe("team-1");
    expect(result.current.pitchBoardLoading).toBe(false);
  });

  it("gives up after stalled loads and reports failure", async () => {
    vi.useFakeTimers();
    try {
      const onLoadFailed = vi.fn();
      const loadRoster = vi.fn().mockReturnValue(new Promise(() => {}));
      const { result } = setup({
        loadRoster,
        findNearbyEvent: vi.fn().mockResolvedValue(null),
        onLoadFailed,
      });

      let openPromise: Promise<void> = Promise.resolve();
      act(() => {
        openPromise = result.current.openPitchBoard("team-1", "Ignite");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await act(async () => {
        await openPromise;
      });

      expect(loadRoster).toHaveBeenCalledTimes(3);
      expect(onLoadFailed).toHaveBeenCalledOnce();
      expect(result.current.pitchBoardTeam).toBeNull();
      expect(result.current.pitchBoardLoading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores only Home-owned persisted pitch boards", async () => {
    localStorage.setItem("ignite-pitch-board-open", "true");
    localStorage.setItem("ignite-pitch-board-open-path", "/home?resume=1");
    localStorage.setItem(
      "ignite-pitch-board-last-context",
      JSON.stringify({
        teamId: "team-3",
        teamName: "Restored Team",
        readOnly: true,
      }),
    );
    const { result } = setup({ findNearbyEvent: vi.fn().mockResolvedValue(null) });
    await waitFor(() =>
      expect(result.current.pitchBoardTeam?.id).toBe("team-3"),
    );
    expect(result.current.pitchBoardTeam?.readOnly).toBe(true);
  });

  it("opens the widget's exact match without rediscovering nearby games", async () => {
    const { args, result } = setup();
    await act(() => result.current.openPitchBoard("team-1", "Ignite", false, "widget-event"));
    expect(args.findNearbyEvent).not.toHaveBeenCalled();
    expect(args.loadGoingRsvps).toHaveBeenCalledWith("widget-event");
    expect(result.current.pitchBoardTeam?.linkedEventId).toBe("widget-event");
  });

  it("restores the saved team's exact match without a new nearby-game lookup", async () => {
    localStorage.setItem("ignite-pitch-board-open", "true");
    localStorage.setItem("ignite-pitch-board-open-path", "/home");
    localStorage.setItem("ignite-pitch-board-last-context", JSON.stringify({ teamId: "team-1", teamName: "Ignite" }));
    localStorage.setItem("pitch-board-timer-state-team-team-1", JSON.stringify({ teamId: "team-1", eventId: "saved-match" }));
    const { args, result } = setup();
    await waitFor(() => expect(result.current.pitchBoardTeam?.linkedEventId).toBe("saved-match"));
    expect(args.findNearbyEvent).not.toHaveBeenCalled();
    expect(args.loadGoingRsvps).toHaveBeenCalledWith("saved-match");
  });

  it("starts attendance while the team roster is still loading", async () => {
    let finishRoster: (value: { members: []; children: [] }) => void = () => {};
    const loadRoster = vi.fn(() => new Promise<{ members: []; children: [] }>((resolve) => { finishRoster = resolve; }));
    const { args, result } = setup({ loadRoster });
    let opening: Promise<void> = Promise.resolve();
    act(() => { opening = result.current.openPitchBoard("team-1", "Ignite"); });
    await waitFor(() => expect(args.loadGoingRsvps).toHaveBeenCalledWith("event-1"));
    expect(result.current.pitchBoardTeam).toBeNull();
    await act(async () => { finishRoster({ members: [], children: [] }); await opening; });
    expect(result.current.pitchBoardTeam?.id).toBe("team-1");
  });

  it("does not time out healthy reads just because their combined time exceeds ten seconds", async () => {
    vi.useFakeTimers();
    try {
      const delayed = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 8_000));
      const onLoadFailed = vi.fn();
      const { args, result } = setup({
        hasProFootballAccess: vi.fn(() => delayed(true)),
        loadRoster: vi.fn(() => delayed({ members: [], children: [] })),
        findNearbyEvent: vi.fn(() => delayed("event-1")),
        loadGoingRsvps: vi.fn(() => delayed([])),
        onLoadFailed,
      });
      let opening: Promise<void> = Promise.resolve();
      act(() => { opening = result.current.openPitchBoard("team-1", "Ignite"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(24_000); await opening; });
      expect(result.current.pitchBoardTeam?.id).toBe("team-1");
      expect(onLoadFailed).not.toHaveBeenCalled();
      expect(args.hasProFootballAccess).toHaveBeenCalledOnce();
      expect(args.loadRoster).toHaveBeenCalledOnce();
      expect(args.loadGoingRsvps).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("shares repeated widget taps and never reopens after close", async () => {
    let finishRoster: (value: { members: []; children: [] }) => void = () => {};
    const loadRoster = vi.fn(() => new Promise<{ members: []; children: [] }>((resolve) => { finishRoster = resolve; }));
    const { result } = setup({ loadRoster });
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.openPitchBoard("team-1", "Ignite");
      second = result.current.openPitchBoard("team-1", "Ignite");
    });
    expect(first).toBe(second);
    await waitFor(() => expect(loadRoster).toHaveBeenCalledOnce());
    act(() => result.current.closePitchBoard());
    await act(async () => { finishRoster({ members: [], children: [] }); await first; });
    expect(result.current.pitchBoardTeam).toBeNull();
    expect(result.current.pitchBoardLoading).toBe(false);
  });

  it("ignores a timed-out roster reply after reporting failure", async () => {
    vi.useFakeTimers();
    try {
      let finishRoster: (value: { members: []; children: [] }) => void = () => {};
      const roster = new Promise<{ members: []; children: [] }>((resolve) => { finishRoster = resolve; });
      const onLoadFailed = vi.fn();
      const { result } = setup({ loadRoster: vi.fn(() => roster), onLoadFailed });
      let opening: Promise<void> = Promise.resolve();
      act(() => { opening = result.current.openPitchBoard("team-1", "Ignite"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await opening; });
      expect(onLoadFailed).toHaveBeenCalledOnce();
      await act(async () => { finishRoster({ members: [], children: [] }); });
      expect(result.current.pitchBoardTeam).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
