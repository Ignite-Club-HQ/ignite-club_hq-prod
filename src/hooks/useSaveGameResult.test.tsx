import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, from, toast } = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), toast: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getUser }, from } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { useSaveGameResult, type SaveGameResultInput } from "./useSaveGameResult";

const input: SaveGameResultInput = {
  teamId: "team-1", eventId: "event-1", sport: "basketball", homeLabel: "Riverside", awayLabel: "United",
  homeScore: 72, awayScore: 68,
  perQuarter: [{ period: 1, home: 18, away: 17 } as any],
  players: [{ id: "player-1", name: "Alex", points: 20 } as any],
  mvpPlayerId: "player-1",
};

function writeResult(error: unknown = null) {
  const chain: any = {};
  chain.upsert = vi.fn(() => chain); chain.insert = vi.fn(() => chain);
  Object.defineProperty(chain, "then", { value: (resolve: any) => Promise.resolve({ error }).then(resolve) });
  return chain;
}

function existingResult(data: unknown, error: unknown = null) {
  const chain: any = {};
  chain.select = vi.fn(() => chain); chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

describe("useSaveGameResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "coach-1" } } });
  });

  it("upserts an event-linked result with exact scope, score, stats and MVP identity", async () => {
    const query = writeResult(); from.mockReturnValueOnce(query);
    const { result } = renderHook(() => useSaveGameResult());
    await act(async () => result.current.save(input));

    expect(from).toHaveBeenCalledWith("game_results");
    expect(query.upsert).toHaveBeenCalledWith({
      team_id: "team-1", event_id: "event-1", sport: "basketball", home_label: "Riverside", away_label: "United",
      home_score: 72, away_score: 68, period_scores: input.perQuarter, player_stats: input.players,
      mvp_player_id: "player-1", mvp_player_name: "Alex", saved_by: "coach-1",
    }, { onConflict: "event_id" });
    expect(result.current.saved).toBe(true);
    expect(toast).toHaveBeenCalledWith({ title: "Game saved", description: "Available in History on the team page." });
  });

  it("inserts an unlinked result rather than using event-id upsert", async () => {
    const query = writeResult(); from.mockReturnValueOnce(query);
    const { result } = renderHook(() => useSaveGameResult());
    await act(async () => result.current.save({ ...input, eventId: null, sport: "netball" }));
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ event_id: null, sport: "netball" }));
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it("skips automatic persistence when onlyIfMissing finds a manual result", async () => {
    const lookup = existingResult({ id: "manual-result" }); from.mockReturnValueOnce(lookup);
    const { result } = renderHook(() => useSaveGameResult());
    await act(async () => result.current.save(input, { onlyIfMissing: true, silent: true }));
    expect(from).toHaveBeenCalledTimes(1);
    expect(result.current.saved).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it("writes when onlyIfMissing confirms no result exists", async () => {
    const lookup = existingResult(null); const write = writeResult();
    from.mockReturnValueOnce(lookup).mockReturnValueOnce(write);
    const { result } = renderHook(() => useSaveGameResult());
    await act(async () => result.current.save(input, { onlyIfMissing: true, silent: true }));
    expect(write.upsert).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated persistence before querying game results", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { result } = renderHook(() => useSaveGameResult());
    await act(async () => result.current.save(input));
    expect(from).not.toHaveBeenCalled(); expect(result.current.saved).toBe(false); expect(toast).not.toHaveBeenCalled();
  });

  it("deduplicates identical completed-game saves but permits a corrected score", async () => {
    const first = writeResult(); const second = writeResult(); from.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { result } = renderHook(() => useSaveGameResult());
    await act(async () => result.current.save(input, { silent: true }));
    await act(async () => result.current.save(input, { silent: true }));
    await act(async () => result.current.save({ ...input, homeScore: 73 }, { silent: true }));
    expect(from).toHaveBeenCalledTimes(2);
    expect(second.upsert).toHaveBeenCalledWith(expect.objectContaining({ home_score: 73 }), expect.anything());
  });

  it("allows force to persist an otherwise identical result", async () => {
    from.mockReturnValueOnce(writeResult()).mockReturnValueOnce(writeResult());
    const { result } = renderHook(() => useSaveGameResult());
    await act(async () => result.current.save(input, { silent: true }));
    await act(async () => result.current.save(input, { silent: true, force: true }));
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("shows a permission-specific failure without marking the result saved", async () => {
    from.mockReturnValueOnce(writeResult({ message: "new row violates row-level security policy" }));
    const { result } = renderHook(() => useSaveGameResult());
    await act(async () => result.current.save(input));
    expect(result.current.saved).toBe(false);
    expect(toast).toHaveBeenCalledWith({
      title: "Could not save game", description: "Only team admins or coaches can save games.", variant: "destructive",
    });
  });

  it("suppresses failure UI in silent mode", async () => {
    from.mockReturnValueOnce(writeResult({ message: "network unavailable" }));
    const { result } = renderHook(() => useSaveGameResult());
    await act(async () => result.current.save(input, { silent: true }));
    expect(result.current.saved).toBe(false); expect(toast).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent saves before either request completes", async () => {
    let releaseWrite!: (value: { error: null }) => void;
    const query: any = {};
    query.upsert = vi.fn(() => query);
    Object.defineProperty(query, "then", {
      value: (resolve: any) =>
        new Promise<{ error: null }>((release) => { releaseWrite = release; })
          .then(resolve),
    });
    from.mockReturnValueOnce(query);
    const { result } = renderHook(() => useSaveGameResult());

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.save(input, { silent: true });
      second = result.current.save(input, { silent: true });
    });
    await vi.waitFor(() => expect(query.upsert).toHaveBeenCalledOnce());
    expect(from).toHaveBeenCalledTimes(1);

    releaseWrite({ error: null });
    await act(async () => Promise.all([first, second]));
    expect(query.upsert).toHaveBeenCalledOnce();
  });

  it("allows retry after a failed write because the result was not saved", async () => {
    const failed = writeResult({ message: "temporary failure" });
    const retry = writeResult();
    from.mockReturnValueOnce(failed).mockReturnValueOnce(retry);
    const { result } = renderHook(() => useSaveGameResult());

    await act(async () => result.current.save(input, { silent: true }));
    await act(async () => result.current.save(input, { silent: true }));

    expect(from).toHaveBeenCalledTimes(2);
    expect(retry.upsert).toHaveBeenCalledOnce();
    expect(result.current.saved).toBe(true);
  });

  it("must not overwrite a manual result when the onlyIfMissing lookup fails", async () => {
    const lookup = existingResult(null, { message: "lookup unavailable" });
    const unsafeWrite = writeResult();
    from.mockReturnValueOnce(lookup).mockReturnValueOnce(unsafeWrite);
    const { result } = renderHook(() => useSaveGameResult());

    await act(async () =>
      result.current.save(input, { onlyIfMissing: true, silent: true }),
    );

    expect(from).toHaveBeenCalledTimes(1);
    expect(unsafeWrite.upsert).not.toHaveBeenCalled();
    expect(result.current.saved).toBe(false);
  });
});
