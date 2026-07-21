import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc, toast, invalidateQueries } = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), toast: vi.fn(), invalidateQueries: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useMutation: (options: any) => ({
    isPending: false,
    mutateAsync: async (input: any) => {
      try { const value = await options.mutationFn(input); options.onSuccess?.(value); return value; }
      catch (error) { options.onError?.(error); throw error; }
    },
  }),
}));

import { useGameStats } from "./useGameStats";

function summaryQuery(error: unknown = null) { return { upsert: vi.fn().mockResolvedValue({ error }) }; }
function deleteQuery(error: unknown = null) {
  const chain: any = {}; chain.delete = vi.fn(() => chain); chain.eq = vi.fn().mockResolvedValue({ error }); return chain;
}
function insertQuery(error: unknown = null) { return { insert: vi.fn().mockResolvedValue({ error }) }; }

const starter: any = { id: "player-1", name: "Alex", number: 9, position: { x: 1, y: 1 }, currentPitchPosition: "ST", minutesPlayed: 3600 };
const substitute: any = { id: "player-2", name: "Blair", position: null, currentPitchPosition: "LW", minutesPlayed: 1200 };
const fillIn: any = { id: "guest-1", name: "Guest Player", number: 14, position: null, minutesPlayed: 600, isFillIn: true };
const params: any = {
  eventId: "event-1", teamId: "team-1", players: [starter, substitute, fillIn], totalGameTime: 5400,
  halfDuration: 2700, formationUsed: "4-3-3", teamSize: 11,
  executedSubs: [{ time: 1200, half: 1, playerOut: starter, playerIn: substitute, executed: true }],
  goals: [
    { id: "g1", scorerId: "player-1", time: 300, half: 1, isOpponentGoal: false },
    { id: "g2", scorerId: "player-1", time: 600, half: 1, isOpponentGoal: false },
    { id: "g3", time: 900, half: 1, isOpponentGoal: true },
  ],
  eventTitle: "League Match", eventDate: "2026-08-01", opponent: "United",
};

describe("useGameStats multi-step persistence", () => {
  beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: null, error: null }); });

  it("saves summary, replaces player stats, then sends the completion email", async () => {
    const summary = summaryQuery(); const deletion = deleteQuery(); const insertion = insertQuery();
    from.mockReturnValueOnce(summary).mockReturnValueOnce(deletion).mockReturnValueOnce(insertion);
    const { result } = renderHook(() => useGameStats());
    await act(async () => result.current.saveGameStats(params));

    expect(summary.upsert).toHaveBeenCalledWith({
      event_id: "event-1", team_id: "team-1", total_game_time: 5400, half_duration: 2700,
      formation_used: "4-3-3", total_substitutions: 1,
    }, { onConflict: "event_id" });
    expect(deletion.eq).toHaveBeenCalledWith("event_id", "event-1");
    expect(insertion.insert).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("send_game_stats_email_rpc", expect.objectContaining({
      _event_id: "event-1", _team_id: "team-1", _total_players: 3, _total_game_time: "90:00",
    }));
  });

  it("normalizes member and fill-in identity, goals, positions and substitutions", async () => {
    const insertion = insertQuery();
    from.mockReturnValueOnce(summaryQuery()).mockReturnValueOnce(deleteQuery()).mockReturnValueOnce(insertion);
    const { result } = renderHook(() => useGameStats());
    await act(async () => result.current.saveGameStats(params));
    const rows = insertion.insert.mock.calls[0][0];
    expect(rows).toContainEqual(expect.objectContaining({
      user_id: "player-1", fill_in_player_name: null, jersey_number: 9, minutes_played: 3600,
      positions_played: ["ST"], substitutions_count: 1, started_on_pitch: true, goals_scored: 2,
    }));
    expect(rows).toContainEqual(expect.objectContaining({
      user_id: null, fill_in_player_name: "Guest Player",
    }));
  });

  it("stops before destructive replacement when the summary cannot be saved", async () => {
    from.mockReturnValueOnce(summaryQuery({ message: "RLS denied" }));
    const { result } = renderHook(() => useGameStats());
    await expect(act(async () => result.current.saveGameStats(params))).rejects.toThrow("Failed to save game summary: RLS denied");
    expect(from).toHaveBeenCalledTimes(1); expect(rpc).not.toHaveBeenCalled();
  });

  it("treats email failure as non-fatal after statistics are safely stored", async () => {
    from.mockReturnValueOnce(summaryQuery()).mockReturnValueOnce(deleteQuery()).mockReturnValueOnce(insertQuery());
    rpc.mockRejectedValue(new Error("email unavailable"));
    const { result } = renderHook(() => useGameStats());
    await expect(act(async () => result.current.saveGameStats(params))).resolves.toEqual({ success: true });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Game stats saved" }));
  });

  it("invalidates summary and stats caches only after full persistence succeeds", async () => {
    from.mockReturnValueOnce(summaryQuery()).mockReturnValueOnce(deleteQuery()).mockReturnValueOnce(insertQuery());
    const { result } = renderHook(() => useGameStats());
    await act(async () => result.current.saveGameStats(params));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["game-stats"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["game-summary"] });
  });

  it("must stop and preserve existing player stats when deleting the old rows fails", async () => {
    from
      .mockReturnValueOnce(summaryQuery())
      .mockReturnValueOnce(deleteQuery({ message: "delete denied" }))
      .mockReturnValueOnce(insertQuery());
    const { result } = renderHook(() => useGameStats());
    await expect(act(async () => result.current.saveGameStats(params))).rejects.toThrow("delete denied");
    expect(from).toHaveBeenCalledTimes(2);
    expect(rpc).not.toHaveBeenCalled();
  });
});
