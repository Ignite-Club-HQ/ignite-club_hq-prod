/**
 * Multi-coach `board_session_id` lock tests for `useCourtSpectator`.
 *
 * Companion to `useCourtSpectator.concurrency.test.tsx` — that file covers
 * the legacy id-fallback path. This file is dedicated to the
 * `board_session_id`-based locking that prevents the spectator from flapping
 * when two coaches simultaneously claim the same team.
 *
 * Scenarios covered:
 *   - Two coaches start at nearly the same instant; spectator must lock onto
 *     whichever session arrived first (initial fetch winner) and stay there.
 *   - Coach A's row id rotates (unique-violation recovery), but the session
 *     id is stable — spectator must follow.
 *   - Coach B's deactivations never disturb the locked session.
 *   - When the locked session ends, the next active session (Coach B) is
 *     adopted on its very next update — no stale state lingers.
 *   - Mixed payloads where some events carry session ids and others don't
 *     (rolling client deploy) — spectator stays on the locked session.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// ────────────────────────────────────────────────────────────────────────────
// Mock the supabase client BEFORE the hook imports it.
// ────────────────────────────────────────────────────────────────────────────
type RealtimeHandler = (payload: { new?: unknown; old?: unknown }) => void;
const realtimeHandlers: RealtimeHandler[] = [];

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
    removeChannel: vi.fn(),
  },
}));

import { useCourtSpectator } from "./useCourtSpectator";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────
const TEAM_ID = "team-shared-001";
const SESSION_A = "session-aaaa-1111";
const SESSION_B = "session-bbbb-2222";

interface RowOpts {
  rowId: string;
  sessionId?: string | null;
  homeScore: number;
  awayScore: number;
  isActive: boolean;
  updatedAt: string;
}

const buildRow = ({
  rowId,
  sessionId,
  homeScore,
  awayScore,
  isActive,
  updatedAt,
}: RowOpts) => ({
  id: rowId,
  team_id: TEAM_ID,
  is_active: isActive,
  updated_at: updatedAt,
  ...(sessionId !== undefined ? { board_session_id: sessionId } : {}),
  pitch_state: { sport: "basketball", players: [] },
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
  for (const handler of [...realtimeHandlers]) {
    act(() => handler(payload));
  }
};

const readScore = (
  result: { current: { state: unknown } }
): number | undefined =>
  (result.current.state as { timer: { homeScore?: number } } | null)?.timer
    .homeScore;

beforeEach(() => {
  realtimeHandlers.length = 0;
  initialFetchResult = { data: null, error: null };
  channelStub.on.mockClear();
  channelStub.subscribe.mockClear();
});

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────
describe("useCourtSpectator board_session_id lock under contention", () => {
  it("locks onto the session present at initial fetch and ignores a competing session", async () => {
    initialFetchResult = {
      data: buildRow({
        rowId: "row-A-initial",
        sessionId: SESSION_A,
        homeScore: 14,
        awayScore: 12,
        isActive: true,
        updatedAt: "2026-04-22T13:00:00.000Z",
      }),
      error: null,
    };

    const { result } = renderHook(() => useCourtSpectator(TEAM_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(readScore(result)).toBe(14);

    // Coach B claims the same team a moment later — newer updated_at, but a
    // different session. Must be ignored entirely.
    for (let i = 0; i < 10; i++) {
      emit({
        new: buildRow({
          rowId: "row-B",
          sessionId: SESSION_B,
          homeScore: 200 + i,
          awayScore: 200 + i,
          isActive: true,
          updatedAt: `2026-04-22T13:00:${String(i + 1).padStart(2, "0")}.000Z`,
        }),
      });
    }
    expect(readScore(result)).toBe(14);

    // Coach A continues — adopted because the session matches.
    emit({
      new: buildRow({
        rowId: "row-A-initial",
        sessionId: SESSION_A,
        homeScore: 16,
        awayScore: 12,
        isActive: true,
        updatedAt: "2026-04-22T13:00:30.000Z",
      }),
    });
    expect(readScore(result)).toBe(16);
  });

  it("follows session A across a row-id rotation (23505 recovery) without ever touching session B", async () => {
    initialFetchResult = {
      data: buildRow({
        rowId: "row-A-1",
        sessionId: SESSION_A,
        homeScore: 2,
        awayScore: 0,
        isActive: true,
        updatedAt: "2026-04-22T14:00:00.000Z",
      }),
      error: null,
    };

    const { result } = renderHook(() => useCourtSpectator(TEAM_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Interleave Coach B noise with Coach A's row-id rotations.
    const aRowIds = ["row-A-1", "row-A-2", "row-A-3", "row-A-4"];
    for (let i = 0; i < 12; i++) {
      // Coach B churn — must be ignored every time.
      emit({
        new: buildRow({
          rowId: `row-B-${i}`,
          sessionId: SESSION_B,
          homeScore: 999,
          awayScore: 999,
          isActive: true,
          updatedAt: `2026-04-22T14:01:${String(i).padStart(2, "0")}.000Z`,
        }),
      });
      // Coach A — same session, but row id rotates every few updates.
      const rowId = aRowIds[i % aRowIds.length];
      emit({
        new: buildRow({
          rowId,
          sessionId: SESSION_A,
          homeScore: i + 1,
          awayScore: 0,
          isActive: true,
          updatedAt: `2026-04-22T14:02:${String(i).padStart(2, "0")}.000Z`,
        }),
      });
      // Spectator must always reflect Coach A — never the 999 score.
      expect(readScore(result)).toBe(i + 1);
    }
  });

  it("ignores Coach B deactivations entirely while session A is locked", async () => {
    initialFetchResult = {
      data: buildRow({
        rowId: "row-A",
        sessionId: SESSION_A,
        homeScore: 21,
        awayScore: 19,
        isActive: true,
        updatedAt: "2026-04-22T15:00:00.000Z",
      }),
      error: null,
    };

    const { result } = renderHook(() => useCourtSpectator(TEAM_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Coach B starts then immediately ends — neither event must affect us.
    emit({
      new: buildRow({
        rowId: "row-B",
        sessionId: SESSION_B,
        homeScore: 5,
        awayScore: 5,
        isActive: true,
        updatedAt: "2026-04-22T15:00:01.000Z",
      }),
    });
    emit({
      new: buildRow({
        rowId: "row-B",
        sessionId: SESSION_B,
        homeScore: 5,
        awayScore: 5,
        isActive: false,
        updatedAt: "2026-04-22T15:00:02.000Z",
      }),
    });

    expect(result.current.noActiveGame).toBe(false);
    expect(readScore(result)).toBe(21);
  });

  it("adopts session B on its next update only after session A deactivates", async () => {
    initialFetchResult = {
      data: buildRow({
        rowId: "row-A",
        sessionId: SESSION_A,
        homeScore: 30,
        awayScore: 28,
        isActive: true,
        updatedAt: "2026-04-22T16:00:00.000Z",
      }),
      error: null,
    };

    const { result } = renderHook(() => useCourtSpectator(TEAM_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Coach B writes are ignored while A is locked.
    emit({
      new: buildRow({
        rowId: "row-B",
        sessionId: SESSION_B,
        homeScore: 60,
        awayScore: 60,
        isActive: true,
        updatedAt: "2026-04-22T16:00:05.000Z",
      }),
    });
    expect(readScore(result)).toBe(30);

    // Session A ends.
    emit({
      new: buildRow({
        rowId: "row-A",
        sessionId: SESSION_A,
        homeScore: 30,
        awayScore: 28,
        isActive: false,
        updatedAt: "2026-04-22T16:00:10.000Z",
      }),
    });
    expect(result.current.state).toBeNull();
    expect(result.current.noActiveGame).toBe(true);

    // Next Coach B tick — now adopted because the lock was released.
    emit({
      new: buildRow({
        rowId: "row-B",
        sessionId: SESSION_B,
        homeScore: 65,
        awayScore: 60,
        isActive: true,
        updatedAt: "2026-04-22T16:00:15.000Z",
      }),
    });
    expect(readScore(result)).toBe(65);
    expect(result.current.noActiveGame).toBe(false);
  });

  it("stays on the locked session even when some payloads omit board_session_id (rolling deploy)", async () => {
    // Initial fetch carries the session id — lock established on SESSION_A.
    initialFetchResult = {
      data: buildRow({
        rowId: "row-A",
        sessionId: SESSION_A,
        homeScore: 8,
        awayScore: 6,
        isActive: true,
        updatedAt: "2026-04-22T17:00:00.000Z",
      }),
      error: null,
    };

    const { result } = renderHook(() => useCourtSpectator(TEAM_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A subsequent Coach A update arrives from an older client that doesn't
    // populate board_session_id — but the row id matches the locked row, so
    // the id-fallback branch keeps us attached.
    emit({
      new: buildRow({
        rowId: "row-A",
        // sessionId omitted on purpose
        homeScore: 10,
        awayScore: 6,
        isActive: true,
        updatedAt: "2026-04-22T17:00:05.000Z",
      }),
    });
    expect(readScore(result)).toBe(10);

    // Coach B writes (with their own session id) — ignored.
    emit({
      new: buildRow({
        rowId: "row-B",
        sessionId: SESSION_B,
        homeScore: 77,
        awayScore: 77,
        isActive: true,
        updatedAt: "2026-04-22T17:00:10.000Z",
      }),
    });
    expect(readScore(result)).toBe(10);

    // Coach A's next update has the session id again — still us.
    emit({
      new: buildRow({
        rowId: "row-A",
        sessionId: SESSION_A,
        homeScore: 12,
        awayScore: 6,
        isActive: true,
        updatedAt: "2026-04-22T17:00:15.000Z",
      }),
    });
    expect(readScore(result)).toBe(12);
  });
});
