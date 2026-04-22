/**
 * Spectator concurrency guard for `useCourtSpectator`.
 *
 * At scale, two coaches may run boards for the same team simultaneously —
 * each writes its own `active_games` row (keyed by `user_id`) and both pump
 * updates every ~10s. Without locking, the spectator would flip between the
 * two coaches' state every cycle as `updated_at` oscillates.
 *
 * These tests simulate that exact scenario:
 *   1. Initial fetch returns Coach A's row.
 *   2. Realtime updates from Coach B (same team, different row id) arrive.
 *   3. Spectator must stay locked to Coach A and ignore Coach B.
 *   4. Only when Coach A deactivates does the lock release.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// ────────────────────────────────────────────────────────────────────────────
// Mock the supabase client BEFORE the hook imports it.
// ────────────────────────────────────────────────────────────────────────────
type RealtimeHandler = (payload: { new?: unknown; old?: unknown }) => void;
const realtimeHandlers: RealtimeHandler[] = [];
const removedChannels: unknown[] = [];

let initialFetchResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};

const channelStub = {
  on: vi.fn((_event: string, _filter: unknown, handler: RealtimeHandler) => {
    realtimeHandlers.push(handler);
    return channelStub;
  }),
  subscribe: vi.fn(() => channelStub),
};

const fromStub = () => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.limit = chain;
  builder.maybeSingle = vi.fn(() => Promise.resolve(initialFetchResult));
  return builder;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => fromStub()),
    channel: vi.fn(() => channelStub),
    removeChannel: vi.fn((ch: unknown) => {
      removedChannels.push(ch);
    }),
  },
}));

// Import AFTER the mock is registered.
import { useCourtSpectator } from "./useCourtSpectator";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────
const TEAM_ID = "team-123";
const COACH_A_ROW_ID = "row-coach-a";
const COACH_B_ROW_ID = "row-coach-b";
const COACH_A_SESSION_ID = "session-coach-a";
const COACH_B_SESSION_ID = "session-coach-b";

interface BoardSnapshot {
  rowId: string;
  homeScore: number;
  awayScore: number;
  isActive: boolean;
  updatedAt: string;
  sessionId?: string | null;
}

const buildRow = ({
  rowId,
  homeScore,
  awayScore,
  isActive,
  updatedAt,
  sessionId,
}: BoardSnapshot) => ({
  id: rowId,
  team_id: TEAM_ID,
  is_active: isActive,
  updated_at: updatedAt,
  // undefined → omit so legacy-row tests still cover the id-fallback branch.
  ...(sessionId !== undefined ? { board_session_id: sessionId } : {}),
  pitch_state: {
    sport: "basketball",
    players: [],
  },
  timer_state: {
    sport: "basketball",
    homeScore,
    awayScore,
    currentQuarter: 1,
    elapsedSeconds: 0,
    minutesPerQuarter: 10,
    timeoutsPerHalf: 4,
  },
});

const emit = (payload: { new?: unknown; old?: unknown }) => {
  // Realtime fires every subscribed handler — copy the array so a handler
  // that re-subscribes during dispatch doesn't pull the rug.
  for (const handler of [...realtimeHandlers]) {
    act(() => handler(payload));
  }
};

beforeEach(() => {
  realtimeHandlers.length = 0;
  removedChannels.length = 0;
  initialFetchResult = { data: null, error: null };
  channelStub.on.mockClear();
  channelStub.subscribe.mockClear();
});

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────
describe("useCourtSpectator multi-coach concurrency", () => {
  it("locks onto the first active row and ignores another coach's writes", async () => {
    // Coach A is already streaming when the spectator opens the page.
    initialFetchResult = {
      data: buildRow({
        rowId: COACH_A_ROW_ID,
        homeScore: 10,
        awayScore: 8,
        isActive: true,
        updatedAt: "2026-04-22T12:00:00.000Z",
      }),
      error: null,
    };

    const { result } = renderHook(() => useCourtSpectator(TEAM_ID));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.state?.sport).toBe("basketball");
    expect(
      (result.current.state as { timer: { homeScore?: number } } | null)?.timer.homeScore
    ).toBe(10);

    // Coach B starts their own board for the same team — different row id,
    // newer updated_at. The spectator must NOT adopt it.
    emit({
      new: buildRow({
        rowId: COACH_B_ROW_ID,
        homeScore: 99,
        awayScore: 99,
        isActive: true,
        updatedAt: "2026-04-22T12:00:05.000Z",
      }),
    });

    // Several rapid updates from Coach B — simulating the 10s sync cycle
    // firing across multiple coaches.
    for (let i = 0; i < 5; i++) {
      emit({
        new: buildRow({
          rowId: COACH_B_ROW_ID,
          homeScore: 50 + i,
          awayScore: 50 + i,
          isActive: true,
          updatedAt: `2026-04-22T12:00:${10 + i}.000Z`,
        }),
      });
    }

    // State must still reflect Coach A's last known scores.
    expect(
      (result.current.state as { timer: { homeScore?: number; awayScore?: number } } | null)?.timer
    ).toMatchObject({ homeScore: 10, awayScore: 8 });

    // But updates to Coach A's own row ARE adopted.
    emit({
      new: buildRow({
        rowId: COACH_A_ROW_ID,
        homeScore: 12,
        awayScore: 8,
        isActive: true,
        updatedAt: "2026-04-22T12:00:20.000Z",
      }),
    });
    expect(
      (result.current.state as { timer: { homeScore?: number } } | null)?.timer.homeScore
    ).toBe(12);
  });

  it("does not flap between coaches across many interleaved updates", async () => {
    initialFetchResult = {
      data: buildRow({
        rowId: COACH_A_ROW_ID,
        homeScore: 0,
        awayScore: 0,
        isActive: true,
        updatedAt: "2026-04-22T12:00:00.000Z",
      }),
      error: null,
    };

    const observedScores: number[] = [];
    const { result } = renderHook(() => useCourtSpectator(TEAM_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Interleave 20 updates: A scores monotonically, B blasts noise.
    for (let i = 1; i <= 20; i++) {
      emit({
        new: buildRow({
          rowId: COACH_B_ROW_ID,
          homeScore: 1000 - i, // would be obvious if adopted
          awayScore: 1000 - i,
          isActive: true,
          updatedAt: `2026-04-22T12:01:${String(i).padStart(2, "0")}.000Z`,
        }),
      });
      emit({
        new: buildRow({
          rowId: COACH_A_ROW_ID,
          homeScore: i,
          awayScore: 0,
          isActive: true,
          updatedAt: `2026-04-22T12:02:${String(i).padStart(2, "0")}.000Z`,
        }),
      });
      observedScores.push(
        (result.current.state as { timer: { homeScore?: number } } | null)?.timer.homeScore ?? -1
      );
    }

    // Scores must be strictly monotonically increasing — no flips into
    // Coach B's 9xx range.
    expect(observedScores).toEqual([...observedScores].sort((a, b) => a - b));
    expect(Math.max(...observedScores)).toBeLessThan(1000);
    expect(observedScores[observedScores.length - 1]).toBe(20);
  });

  it("releases the lock when the locked row deactivates and adopts the next coach", async () => {
    initialFetchResult = {
      data: buildRow({
        rowId: COACH_A_ROW_ID,
        homeScore: 5,
        awayScore: 5,
        isActive: true,
        updatedAt: "2026-04-22T12:00:00.000Z",
      }),
      error: null,
    };

    const { result } = renderHook(() => useCourtSpectator(TEAM_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Coach B's writes are ignored while A is locked.
    emit({
      new: buildRow({
        rowId: COACH_B_ROW_ID,
        homeScore: 77,
        awayScore: 77,
        isActive: true,
        updatedAt: "2026-04-22T12:00:05.000Z",
      }),
    });
    expect(
      (result.current.state as { timer: { homeScore?: number } } | null)?.timer.homeScore
    ).toBe(5);

    // Coach A ends their game — spectator clears state and reports no game.
    emit({
      new: buildRow({
        rowId: COACH_A_ROW_ID,
        homeScore: 5,
        awayScore: 5,
        isActive: false,
        updatedAt: "2026-04-22T12:00:10.000Z",
      }),
    });
    expect(result.current.state).toBeNull();
    expect(result.current.noActiveGame).toBe(true);

    // Now Coach B's next update should be adopted (lock released).
    emit({
      new: buildRow({
        rowId: COACH_B_ROW_ID,
        homeScore: 80,
        awayScore: 80,
        isActive: true,
        updatedAt: "2026-04-22T12:00:15.000Z",
      }),
    });
    expect(
      (result.current.state as { timer: { homeScore?: number } } | null)?.timer.homeScore
    ).toBe(80);
    expect(result.current.noActiveGame).toBe(false);
  });

  it("ignores deactivations on rows we never locked onto", async () => {
    initialFetchResult = {
      data: buildRow({
        rowId: COACH_A_ROW_ID,
        homeScore: 3,
        awayScore: 3,
        isActive: true,
        updatedAt: "2026-04-22T12:00:00.000Z",
      }),
      error: null,
    };

    const { result } = renderHook(() => useCourtSpectator(TEAM_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Coach B deactivates their own row — must not affect spectator at all.
    emit({
      new: buildRow({
        rowId: COACH_B_ROW_ID,
        homeScore: 0,
        awayScore: 0,
        isActive: false,
        updatedAt: "2026-04-22T12:00:05.000Z",
      }),
    });

    expect(result.current.state).not.toBeNull();
    expect(result.current.noActiveGame).toBe(false);
    expect(
      (result.current.state as { timer: { homeScore?: number } } | null)?.timer.homeScore
    ).toBe(3);
  });
});
