import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, invoke, loadFlags, tableResults } = vi.hoisted(() => ({
  from: vi.fn(), invoke: vi.fn(), loadFlags: vi.fn(), tableResults: new Map<string, { data: any[]; error: any }>(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, functions: { invoke } } }));
vi.mock("@/components/pitch/pitchBoardNotifyFlags", () => ({
  loadPitchNotifyFlags: loadFlags,
  enabledRoleListFromFlags: (flags: any) => [flags.team_admin && "team_admin", flags.coach && "coach"].filter(Boolean),
}));

import { useAutoSubNotify } from "./useAutoSubNotify";

function queryFor(table: string) {
  const chain: any = {};
  for (const method of ["select", "eq", "in", "not"]) chain[method] = vi.fn(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: any) => Promise.resolve(tableResults.get(table) ?? { data: [], error: null }).then(resolve),
  });
  return chain;
}

const substitution = { playerInName: "Alex", playerOutName: "Blair", position: "Goal Attack", periodLabel: "Q2" };

describe("useAutoSubNotify recipient permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks(); tableResults.clear();
    from.mockImplementation(queryFor); invoke.mockResolvedValue({ data: null, error: null });
    loadFlags.mockResolvedValue({ coach: true, team_admin: true, subs_manager: true });
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-07-19T12:00:00Z").getTime());
  });

  it("does nothing without a team identity", async () => {
    const { result } = renderHook(() => useAutoSubNotify("", "Riverside"));
    await act(async () => result.current(substitution));
    expect(loadFlags).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
  });

  it("honours enabled team roles and includes the linked-event Subs Manager", async () => {
    tableResults.set("user_roles", { data: [{ user_id: "coach-1" }, { user_id: "admin-1" }], error: null });
    tableResults.set("duties", { data: [{ assigned_to: "subs-1" }], error: null });
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Riverside", "event-1"));
    await act(async () => result.current(substitution));

    expect(loadFlags).toHaveBeenCalledWith("team-1");
    expect(from.mock.calls.map(([table]) => table)).toEqual(["user_roles", "duties"]);
    expect(invoke.mock.calls.map(([, options]) => options.body.userId)).toEqual(["coach-1", "admin-1", "subs-1"]);
    expect(invoke).toHaveBeenCalledWith("send-push-notification", { body: expect.objectContaining({
      title: "Riverside — Auto-sub", body: "Alex ON for Blair at Goal Attack (Q2)", tag: "auto-sub-team-1",
      notificationType: "pitch_board_auto_sub",
    }) });
  });

  it("deduplicates a user who is both a coach and Subs Manager", async () => {
    tableResults.set("user_roles", { data: [{ user_id: "user-1" }, { user_id: "user-1" }], error: null });
    tableResults.set("duties", { data: [{ assigned_to: "user-1" }], error: null });
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Riverside", "event-1"));
    await act(async () => result.current(substitution));
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("does not query muted roles or Subs Manager duties", async () => {
    loadFlags.mockResolvedValue({ coach: false, team_admin: false, subs_manager: false });
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Riverside", "event-1"));
    await act(async () => result.current(substitution));
    expect(from).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
  });

  it("uses only referee and Subs Manager duty assignees for mini-league event groups", async () => {
    tableResults.set("event_group_duties", { data: [
      { assigned_to: "referee-1" }, { assigned_to: "subs-1" }, { assigned_to: "referee-1" },
    ], error: null });
    const { result } = renderHook(() => useAutoSubNotify("event-group-group-1", "Mini League"));
    await act(async () => result.current(substitution));
    expect(loadFlags).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("event_group_duties");
    expect(invoke.mock.calls.map(([, options]) => options.body.userId)).toEqual(["referee-1", "subs-1"]);
  });

  it("deduplicates the same substitution within a minute but permits a different period", async () => {
    tableResults.set("user_roles", { data: [{ user_id: "coach-1" }], error: null });
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Riverside"));
    await act(async () => result.current(substitution));
    await act(async () => result.current(substitution));
    await act(async () => result.current({ ...substitution, periodLabel: "Q3" }));
    expect(from).toHaveBeenCalledTimes(2); expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("sends nothing when recipient lookup fails", async () => {
    tableResults.set("user_roles", { data: [], error: { message: "RLS denied" } });
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Riverside"));
    await expect(act(async () => result.current(substitution))).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not let an individual push failure reject the board operation", async () => {
    tableResults.set("user_roles", { data: [{ user_id: "coach-1" }], error: null });
    invoke.mockRejectedValue(new Error("push unavailable"));
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Riverside"));
    await expect(act(async () => result.current(substitution))).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("still notifies a Subs Manager when the enabled-role lookup fails", async () => {
    tableResults.set("user_roles", { data: [], error: { message: "roles unavailable" } });
    tableResults.set("duties", { data: [{ assigned_to: "subs-1" }], error: null });
    const { result } = renderHook(() =>
      useAutoSubNotify("team-1", "Riverside", "event-1"),
    );

    await expect(
      act(async () => result.current(substitution)),
    ).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0][1].body.userId).toBe("subs-1");
  });

  it("formats a notification without an empty period suffix when no period is supplied", async () => {
    tableResults.set("user_roles", { data: [{ user_id: "coach-1" }], error: null });
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Riverside"));

    await act(async () =>
      result.current({
        playerInName: "Alex",
        playerOutName: "Blair",
        position: "Goal Attack",
      }),
    );

    expect(invoke).toHaveBeenCalledWith(
      "send-push-notification",
      { body: expect.objectContaining({ body: "Alex ON for Blair at Goal Attack" }) },
    );
  });

  it("allows the same substitution notification again in a later minute", async () => {
    tableResults.set("user_roles", { data: [{ user_id: "coach-1" }], error: null });
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Riverside"));

    await act(async () => result.current(substitution));
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-07-19T12:01:00Z").getTime());
    await act(async () => result.current(substitution));

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("allows retry in the same minute when recipient discovery failed before any push was sent", async () => {
    tableResults.set("user_roles", { data: [], error: { message: "temporary lookup failure" } });
    const { result } = renderHook(() => useAutoSubNotify("team-1", "Riverside"));

    await act(async () => result.current(substitution));
    expect(invoke).not.toHaveBeenCalled();

    tableResults.set("user_roles", { data: [{ user_id: "coach-1" }], error: null });
    await act(async () => result.current(substitution));

    expect(from).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledOnce();
  });
});
