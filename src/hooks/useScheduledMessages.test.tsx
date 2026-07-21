import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, invalidateQueries, authState, from } = vi.hoisted(() => ({
  invoke: vi.fn(), invalidateQueries: vi.fn(), from: vi.fn(), authState: { user: { id: "user-1" } as { id: string } | null },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke }, from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useQuery: (options: any) => ({ options }),
  useMutation: (options: any) => ({ mutationFn: options.mutationFn, runSuccess: options.onSuccess }),
}));

import {
  targetMatches,
  useAllScheduledMessages,
  useCancelScheduledMessage,
  useCreateScheduledMessage,
  useThreadScheduledMessages,
  useUpdateScheduledMessage,
  type ScheduledMessageRow,
} from "./useScheduledMessages";

const baseRow = {
  id: "scheduled-1", author_id: "user-1", chat_type: "team", team_id: "team-1", club_id: null,
  group_id: null, conversation_id: null, text: "Later", image_url: null, reply_to_id: null,
  scheduled_for: "2026-08-01T10:00:00.000Z", status: "pending", sent_message_id: null,
  error_message: null, attempted_at: null, recurrence: "none", recurrence_until: null,
  recurrence_parent_id: null, created_at: "2026-07-19T10:00:00.000Z", updated_at: "2026-07-19T10:00:00.000Z",
} satisfies ScheduledMessageRow;

describe("scheduled message scope and writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: "user-1" };
    invoke.mockResolvedValue({ data: { row: baseRow }, error: null });
  });

  it("matches only when chat type and every target identifier agree", () => {
    expect(targetMatches(baseRow, { chat_type: "team", team_id: "team-1" })).toBe(true);
    expect(targetMatches(baseRow, { chat_type: "club", team_id: "team-1" })).toBe(false);
    expect(targetMatches(baseRow, { chat_type: "team", team_id: "team-2" })).toBe(false);
    expect(targetMatches(baseRow, { chat_type: "team", team_id: "team-1", club_id: "club-1" })).toBe(false);
  });

  it.each([
    ["team", { team_id: "team-1" }],
    ["club", { club_id: "club-1" }],
    ["group", { group_id: "group-1" }],
    ["direct", { conversation_id: "dm-1" }],
    ["club_admin", { conversation_id: "admin-thread-1" }],
    ["broadcast", {}],
  ] as const)("creates a %s schedule with only its intended target populated", async (chatType, target) => {
    const { result } = renderHook(() => useCreateScheduledMessage());
    await act(async () => result.current.mutationFn({
      chat_type: chatType,
      ...target,
      text: "Synthetic scheduled message",
      scheduled_for: new Date("2026-08-02T12:30:00.000Z"),
    }));

    expect(invoke).toHaveBeenCalledWith("scheduled-messages-write", { body: {
      action: "create", chat_type: chatType,
      team_id: "team_id" in target ? target.team_id : null,
      club_id: "club_id" in target ? target.club_id : null,
      group_id: "group_id" in target ? target.group_id : null,
      conversation_id: "conversation_id" in target ? target.conversation_id : null,
      text: "Synthetic scheduled message", image_url: null, reply_to_id: null,
      scheduled_for: "2026-08-02T12:30:00.000Z", recurrence: "none", recurrence_until: null,
    }});
  });

  it("rejects unauthenticated creation before invoking the Edge Function", async () => {
    authState.user = null;
    const { result } = renderHook(() => useCreateScheduledMessage());
    await expect(result.current.mutationFn({ chat_type: "club", club_id: "club-1", text: "No", scheduled_for: new Date() }))
      .rejects.toThrow("Not authenticated");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("serializes recurrence dates and preserves explicit empty text", async () => {
    const { result } = renderHook(() => useCreateScheduledMessage());
    await result.current.mutationFn({
      chat_type: "group", group_id: "group-1", text: "", scheduled_for: new Date("2026-08-02T12:30:00Z"),
      recurrence: "weekly", recurrence_until: new Date("2026-10-01T00:00:00Z"),
    });
    expect(invoke).toHaveBeenCalledWith("scheduled-messages-write", { body: expect.objectContaining({
      text: "", recurrence: "weekly", recurrence_until: "2026-10-01T00:00:00.000Z",
    }) });
  });

  it("updates only fields explicitly supplied", async () => {
    const { result } = renderHook(() => useUpdateScheduledMessage());
    await result.current.mutationFn({ id: "scheduled-1", text: "Changed", image_url: null });
    expect(invoke).toHaveBeenCalledWith("scheduled-messages-write", { body: {
      action: "update", id: "scheduled-1", text: "Changed", image_url: null,
    }});
  });

  it("cancels only the selected scheduled-message id", async () => {
    const { result } = renderHook(() => useCancelScheduledMessage());
    await result.current.mutationFn("scheduled-1");
    expect(invoke).toHaveBeenCalledWith("scheduled-messages-write", { body: { action: "cancel", id: "scheduled-1" } });
  });

  it("rejects unauthenticated updates before invoking the Edge Function", async () => {
    authState.user = null;
    const { result } = renderHook(() => useUpdateScheduledMessage());

    await expect(
      result.current.mutationFn({ id: "scheduled-1", text: "Changed" }),
    ).rejects.toThrow("Not authenticated");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated cancellation before invoking the Edge Function", async () => {
    authState.user = null;
    const { result } = renderHook(() => useCancelScheduledMessage());

    await expect(result.current.mutationFn("scheduled-1")).rejects.toThrow(
      "Not authenticated",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not invalidate caches when a write returns a permission error", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: "Forbidden" },
    });
    const update = renderHook(() => useUpdateScheduledMessage()).result.current;

    await expect(
      update.mutationFn({ id: "scheduled-1", text: "Denied" }),
    ).rejects.toThrow("Forbidden");
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("surfaces the server's Pro-required response with a machine-readable code", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: "function failed", context: { json: vi.fn().mockResolvedValue({ error: "pro_required" }) } },
    });
    const { result } = renderHook(() => useCreateScheduledMessage());
    const promise = result.current.mutationFn({
      chat_type: "team", team_id: "team-1", text: "Later", scheduled_for: new Date("2026-08-02T12:30:00Z"),
    });
    await expect(promise).rejects.toMatchObject({ message: "Pro required", code: "pro_required" });
  });

  it("invalidates both thread and all-message caches after successful writes", () => {
    const create = renderHook(() => useCreateScheduledMessage()).result.current;
    create.runSuccess();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["scheduled-messages-thread"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["scheduled-messages-all"] });
  });

  it("scopes a thread read to the current author, pending status, and every exact target field", async () => {
    const chain: any = {};
    for (const method of ["select", "eq", "is", "order"]) chain[method] = vi.fn(() => chain);
    Object.defineProperty(chain, "then", {
      value: (resolve: any) => Promise.resolve({ data: [baseRow], error: null }).then(resolve),
    });
    from.mockReturnValue(chain);
    const target = { chat_type: "team" as const, team_id: "team-1" };
    const { result } = renderHook(() => useThreadScheduledMessages(target));

    await expect(result.current.options.queryFn()).resolves.toEqual([baseRow]);
    expect(from).toHaveBeenCalledWith("scheduled_messages");
    expect(chain.eq).toHaveBeenCalledWith("author_id", "user-1");
    expect(chain.eq).toHaveBeenCalledWith("status", "pending");
    expect(chain.eq).toHaveBeenCalledWith("chat_type", "team");
    expect(chain.eq).toHaveBeenCalledWith("team_id", "team-1");
    expect(chain.is).toHaveBeenCalledWith("club_id", null);
    expect(chain.is).toHaveBeenCalledWith("group_id", null);
    expect(chain.is).toHaveBeenCalledWith("conversation_id", null);
    expect(chain.order).toHaveBeenCalledWith("scheduled_for", { ascending: true });
  });

  it("does not read a thread when signed out or no target was supplied", async () => {
    authState.user = null;
    const { result } = renderHook(() => useThreadScheduledMessages(null));

    expect(result.current.options.enabled).toBe(false);
    await expect(result.current.options.queryFn()).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("must propagate a thread fetch failure instead of caching an empty schedule", async () => {
    const chain: any = {};
    for (const method of ["select", "eq", "is", "order"]) chain[method] = vi.fn(() => chain);
    Object.defineProperty(chain, "then", {
      value: (resolve: any) => Promise.resolve({ data: null, error: { message: "schedule lookup denied" } }).then(resolve),
    });
    from.mockReturnValue(chain);
    const { result } = renderHook(() => useThreadScheduledMessages({ chat_type: "club", club_id: "club-1" }));

    await expect(result.current.options.queryFn()).rejects.toMatchObject({ message: "schedule lookup denied" });
  });

  it("scopes the all-messages view to the current author and requested statuses", async () => {
    const chain: any = {};
    for (const method of ["select", "eq", "in", "order"]) chain[method] = vi.fn(() => chain);
    Object.defineProperty(chain, "then", {
      value: (resolve: any) => Promise.resolve({ data: [baseRow], error: null }).then(resolve),
    });
    from.mockReturnValue(chain);
    const { result } = renderHook(() => useAllScheduledMessages(["pending", "failed"]));

    await expect(result.current.options.queryFn()).resolves.toEqual([baseRow]);
    expect(chain.eq).toHaveBeenCalledWith("author_id", "user-1");
    expect(chain.in).toHaveBeenCalledWith("status", ["pending", "failed"]);
    expect(result.current.options.queryKey).toEqual(["scheduled-messages-all", "user-1", "pending,failed"]);
  });

  it("must propagate an all-messages fetch failure instead of hiding every schedule", async () => {
    const chain: any = {};
    for (const method of ["select", "eq", "in", "order"]) chain[method] = vi.fn(() => chain);
    Object.defineProperty(chain, "then", {
      value: (resolve: any) => Promise.resolve({ data: null, error: { message: "scheduled list unavailable" } }).then(resolve),
    });
    from.mockReturnValue(chain);
    const { result } = renderHook(() => useAllScheduledMessages());

    await expect(result.current.options.queryFn()).rejects.toMatchObject({ message: "scheduled list unavailable" });
  });
});
