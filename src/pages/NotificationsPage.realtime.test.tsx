import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Binding = {
  event: string;
  config: Record<string, unknown>;
  handler: (payload: any) => void;
};

type ChannelRecord = {
  topic: string;
  bindings: Binding[];
  operations: string[];
  subscribed: boolean;
  subscribeCount: number;
  lateCallbackCount: number;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  const setQueriesData = vi.fn();
  const setQueryData = vi.fn();
  const getQueriesData = vi.fn();
  const cancelQueries = vi.fn().mockResolvedValue(undefined);
  const invalidateQueries = vi.fn();
  return {
    currentUser: { id: "user-1" } as { id: string } | null,
    channels: new Map<string, ChannelRecord>(),
    removed: [] as ChannelRecord[],
    channel: vi.fn(),
    removeChannel: vi.fn(),
    setQueriesData,
    setQueryData,
    getQueriesData,
    cancelQueries,
    invalidateQueries,
    queryClient: {
      setQueriesData,
      setQueryData,
      getQueriesData,
      cancelQueries,
      invalidateQueries,
    },
    mutationOptions: [] as any[],
    refreshUnreadCount: vi.fn(),
    navigate: vi.fn(),
  };
});

function createChannel(topic: string): ChannelRecord {
  const record = {
    topic,
    bindings: [],
    operations: [],
    subscribed: false,
    subscribeCount: 0,
    lateCallbackCount: 0,
  } as ChannelRecord;

  record.on = vi.fn(
    (
      event: string,
      config: Record<string, unknown>,
      handler: (payload: any) => void,
    ) => {
      record.operations.push(`on:${String(config.event)}`);
      if (record.subscribed) record.lateCallbackCount += 1;
      record.bindings.push({ event, config, handler });
      return record;
    },
  );
  record.subscribe = vi.fn(() => {
    record.operations.push("subscribe");
    record.subscribeCount += 1;
    record.subscribed = true;
    return record;
  });

  return record;
}

function queryBuilder() {
  const chain: any = {};
  for (const method of [
    "select",
    "eq",
    "order",
    "limit",
    "or",
    "update",
    "delete",
    "in",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (
    resolve: (value: { data: unknown[]; error: null }) => unknown,
  ) => Promise.resolve({ data: [], error: null }).then(resolve);
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
    from: vi.fn(() => queryBuilder()),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mocks.currentUser,
    refreshUnreadCount: mocks.refreshUnreadCount,
    clearUnreadCount: vi.fn(),
  }),
}));

vi.mock("@/hooks/useClubTheme", () => ({
  useClubTheme: () => ({ activeClubFilter: null }),
}));

vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/lib/profileCache", () => ({
  selectCachedProfileById: vi.fn().mockResolvedValue({ data: null }),
}));
vi.mock("@/lib/notifications", () => ({
  playNotificationSound: vi.fn(),
  showBrowserNotification: vi.fn(),
}));
vi.mock("@/components/NotificationIcon", () => ({
  useNotificationIcon: () => ({
    Icon: () => null,
    reactionEmoji: null,
    colorClass: "",
  }),
}));
vi.mock("@/components/SwipeableNotificationCard", () => ({
  SwipeableNotificationCard: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
  useQuery: () => ({ data: [], isLoading: false }),
  useMutation: (options: any) => {
    mocks.mutationOptions.push(options);
    return {
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    };
  },
}));

import NotificationsPage from "./NotificationsPage";

function seedSubscribedGlobalChannel(topic = "notifications-realtime") {
  const global = createChannel(topic);
  global.on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "notifications" },
    vi.fn(),
  );
  global.on(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: "notifications" },
    vi.fn(),
  );
  global.on(
    "postgres_changes",
    { event: "DELETE", schema: "public", table: "notifications" },
    vi.fn(),
  );
  global.subscribe();
  mocks.channels.set(topic, global);
  return global;
}

function pageChannel(global: ChannelRecord): ChannelRecord | undefined {
  return [...mocks.channels.values()].find((candidate) => candidate !== global);
}

function onlyChannel(): ChannelRecord | undefined {
  return [...mocks.channels.values()][0];
}

describe("NotificationsPage Realtime ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = { id: "user-1" };
    mocks.channels.clear();
    mocks.removed.length = 0;
    mocks.mutationOptions.length = 0;
    mocks.getQueriesData.mockReturnValue([]);

    // Match Supabase Realtime semantics: requesting an existing topic returns
    // the existing channel object rather than allocating another channel.
    mocks.channel.mockImplementation((topic: string) => {
      const existing = mocks.channels.get(topic);
      if (existing) return existing;
      const created = createChannel(topic);
      mocks.channels.set(topic, created);
      return created;
    });
    mocks.removeChannel.mockImplementation(async (record: ChannelRecord) => {
      mocks.removed.push(record);
      if (mocks.channels.get(record.topic) === record) {
        mocks.channels.delete(record.topic);
      }
      record.subscribed = false;
      return "ok";
    });
  });

  it("does not reuse or mutate an already-subscribed global notification channel", async () => {
    const global = seedSubscribedGlobalChannel();
    render(<NotificationsPage />);

    await waitFor(() => expect(mocks.channel).toHaveBeenCalled());
    const page = pageChannel(global);

    expect(page).toBeDefined();
    expect(page).not.toBe(global);
    expect(page?.topic).toContain("user-1");
    expect(global.bindings).toHaveLength(3);
    expect(global.subscribeCount).toBe(1);
    expect(global.lateCallbackCount).toBe(0);
  });

  it("attaches INSERT, UPDATE and DELETE handlers before subscribing once", async () => {
    render(<NotificationsPage />);

    await waitFor(() => expect(onlyChannel()?.subscribed).toBe(true));
    const page = onlyChannel()!;

    expect(page.operations).toEqual([
      "on:INSERT",
      "on:UPDATE",
      "on:DELETE",
      "subscribe",
    ]);
    expect(page.subscribeCount).toBe(1);
    expect(page.lateCallbackCount).toBe(0);
    expect(page.bindings.map(({ config }) => config.filter)).toEqual([
      "user_id=eq.user-1",
      "user_id=eq.user-1",
      "user_id=eq.user-1",
    ]);
  });

  it("keeps the subscription stable across ordinary page rerenders", async () => {
    const view = render(<NotificationsPage />);
    await waitFor(() => expect(onlyChannel()?.subscribed).toBe(true));
    const page = onlyChannel()!;

    view.rerender(<NotificationsPage />);

    expect(mocks.channel).toHaveBeenCalledTimes(1);
    expect(page.subscribeCount).toBe(1);
    expect(mocks.removed).not.toContain(page);
  });

  it("removes only the page-owned channel when leaving notifications", async () => {
    const global = seedSubscribedGlobalChannel();
    const view = render(<NotificationsPage />);
    await waitFor(() => expect(pageChannel(global)?.subscribed).toBe(true));
    const page = pageChannel(global)!;

    view.unmount();

    expect(mocks.removed).toContain(page);
    expect(mocks.removed).not.toContain(global);
    expect(global.subscribed).toBe(true);
  });

  it("replaces the page channel with a newly user-scoped channel on account change", async () => {
    const view = render(<NotificationsPage />);
    await waitFor(() => expect(onlyChannel()?.subscribed).toBe(true));
    const first = onlyChannel()!;

    mocks.currentUser = { id: "user-2" };
    view.rerender(<NotificationsPage />);

    await waitFor(() => {
      expect(
        [...mocks.channels.values()].some(
          (record) => record.topic.includes("user-2"),
        ),
      ).toBe(true);
    });
    const second = [...mocks.channels.values()].find(
      (record) => record.topic.includes("user-2"),
    )!;

    expect(first.topic).toContain("user-1");
    expect(second).not.toBe(first);
    expect(mocks.removed).toContain(first);
    expect(second.bindings.every(({ config }) =>
      config.filter === "user_id=eq.user-2"
    )).toBe(true);
  });

  it.each([
    ["mark one read", 0, "notification-1"],
    ["mark visible read", 1, undefined],
    ["delete one", 2, "notification-1"],
    ["clear visible", 3, undefined],
  ])("restores cached rows when %s fails", async (_label, mutationIndex, variable) => {
    const original = [{ id: "notification-1", read: false }];
    const exactKey = ["notifications", "user-1", "all"];
    mocks.getQueriesData.mockReturnValue([[exactKey, original]]);
    render(<NotificationsPage />);

    const mutation = mocks.mutationOptions[mutationIndex];
    expect(mutation).toBeDefined();
    const context = await mutation.onMutate(variable);
    expect(context.snapshots).toEqual([[exactKey, original]]);

    mutation.onError(new Error("network unavailable"), variable, context);

    expect(mocks.setQueryData).toHaveBeenCalledWith(exactKey, original);
    expect(mocks.refreshUnreadCount).toHaveBeenCalled();
  });

  it("updates the notification cache and unread count for an INSERT", async () => {
    render(<NotificationsPage />);
    await waitFor(() => expect(onlyChannel()?.subscribed).toBe(true));
    const page = onlyChannel()!;
    const insert = page.bindings.find(
      ({ config }) => config.event === "INSERT",
    )!;

    await act(async () => {
      insert.handler({
        new: {
          id: "notification-1",
          user_id: "user-1",
          message: "Training moved",
          is_read: false,
        },
      });
    });

    expect(mocks.setQueriesData).toHaveBeenCalledWith(
      { queryKey: ["notifications", "user-1"] },
      expect.any(Function),
    );
    const updater = mocks.setQueriesData.mock.calls.at(-1)?.[1];
    expect(updater([])).toEqual([
      expect.objectContaining({
        id: "notification-1",
        user_id: "user-1",
        read: false,
      }),
    ]);
    expect(mocks.refreshUnreadCount).toHaveBeenCalled();
  });

  it("updates and deletes only the matching cached notification", async () => {
    render(<NotificationsPage />);
    await waitFor(() => expect(onlyChannel()?.subscribed).toBe(true));
    const page = onlyChannel()!;

    const update = page.bindings.find(
      ({ config }) => config.event === "UPDATE",
    )!;
    act(() => update.handler({
      new: { id: "notification-1", user_id: "user-1", is_read: true },
    }));
    const updateCache = mocks.setQueriesData.mock.calls.at(-1)?.[1];
    expect(updateCache([
      { id: "notification-1", read: false },
      { id: "notification-2", read: false },
    ])).toEqual([
      expect.objectContaining({ id: "notification-1", read: true }),
      { id: "notification-2", read: false },
    ]);

    const remove = page.bindings.find(
      ({ config }) => config.event === "DELETE",
    )!;
    act(() => remove.handler({ old: { id: "notification-1" } }));
    const deleteCache = mocks.setQueriesData.mock.calls.at(-1)?.[1];
    expect(deleteCache([
      { id: "notification-1" },
      { id: "notification-2" },
    ])).toEqual([{ id: "notification-2" }]);
  });
});
