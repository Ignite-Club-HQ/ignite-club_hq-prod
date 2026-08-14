import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Operation = {
  table: string;
  kind: "insert" | "update" | "delete";
  payload?: any;
  filters: Array<[string, any]>;
};

const mocks = vi.hoisted(() => ({
  mutations: [] as any[],
  operations: [] as Operation[],
  invalidateQueries: vi.fn(),
  refetchQueries: vi.fn(),
  toast: vi.fn(),
  queueRsvp: vi.fn(),
  awardPoints: vi.fn(),
  rpc: vi.fn(),
  results: {} as Record<string, Array<{ data: any; error: any }>>,
  isAdmin: true,
  isAppAdmin: false,
  eventError: null as any,
  eventData: null as any,
  rsvps: [] as any[],
  duties: [] as any[],
  invoke: vi.fn(),
  payments: [] as any[],
  createCheckout: vi.fn(),
  listenForPayment: vi.fn(),
  paymentCallback: null as null | ((status: "paid" | "failed", payload?: any) => void),
  paymentCleanup: vi.fn(),
  isNative: false,
  safeOpenUrl: vi.fn(),
  queries: [] as any[],
  queryErrors: {} as Record<string, any>,
  queryLoading: {} as Record<string, boolean>,
  queryFetching: {} as Record<string, boolean>,
  queryRefetches: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

const mutationNames = [
  "parentLeaguePlayerRsvp", "rsvp", "childRsvp", "adminRsvp",
  "adminUpdateRsvp", "rsvpForMember", "rsvpForChild", "togglePayment",
  "addDuty", "claimDuty", "completeDuty", "uncompleteDuty", "deleteDuty",
  "assignDuty", "cancelEvent", "remind", "individualRemind",
  "resendInvites",
];

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
      refetchQueries: mocks.refetchQueries,
    }),
    useQuery: (options: any) => {
      mocks.queries.push(options);
      const key = options.queryKey?.[0];
      const values: Record<string, any> = {
        event: mocks.eventData,
        "event-rsvps": mocks.rsvps, "event-guests": [], "event-duties": mocks.duties,
        "is-app-admin": mocks.isAppAdmin, "event-admin-check": mocks.isAdmin,
        "team-pro-football-status": true, "team-pro-status": true,
        "event-subs-manager-direct": false, "is-team-member": true,
        "active-game-summary": null, "team-members-for-pitch": [],
        "team-subscription-for-pitch": null, "event-members-with-roles": [],
        "mini-league-players-for-event": [], "mini-league-adults-for-event": [],
        "my-mini-league-players-for-event": [], "mini-league-duty-assignees-session": [],
        "children-on-team": [], "targeted-event-roster": [],
        "child-guardians-on-team": [], "event-payments": mocks.payments,
        "match-captain": null, "player-of-match": null, "match-goalkeepers": [],
        "event-recent-reminders": new Map(),
      };
      const refetch = mocks.queryRefetches[key] ?? vi.fn();
      mocks.queryRefetches[key] = refetch;
      return {
        data: values[key], error: mocks.queryErrors[key] ?? (key === "event" ? mocks.eventError : null),
        isLoading: mocks.queryLoading[key] ?? false,
        isFetching: mocks.queryFetching[key] ?? false,
        isFetched: !(mocks.queryLoading[key] ?? false),
        isSuccess: !mocks.queryErrors[key], refetch,
      };
    },
    useMutation: (options: any) => {
      mocks.mutations.push(options);
      return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
    },
  };
});

function takeResult(table: string, kind: string) {
  return mocks.results[`${table}:${kind}`]?.shift() ?? { data: null, error: null };
}

function queryFor(table: string) {
  let operation: Operation | null = null;
  let selectedAfterWrite = false;
  const query: any = {};
  query.select = vi.fn(() => { selectedAfterWrite = !!operation; return query; });
  query.insert = vi.fn((payload: any) => {
    operation = { table, kind: "insert", payload, filters: [] };
    mocks.operations.push(operation);
    return query;
  });
  query.update = vi.fn((payload: any) => {
    operation = { table, kind: "update", payload, filters: [] };
    mocks.operations.push(operation);
    return query;
  });
  query.delete = vi.fn(() => {
    operation = { table, kind: "delete", filters: [] };
    mocks.operations.push(operation);
    return query;
  });
  query.eq = vi.fn((column: string, value: any) => {
    operation?.filters.push([column, value]);
    return query;
  });
  for (const method of ["in", "is", "not", "gte", "order", "limit", "or"]) query[method] = vi.fn(() => query);
  const resolve = () => {
    const kind = operation?.kind ?? "select";
    const configured = takeResult(table, kind);
    if (operation && selectedAfterWrite && configured.data == null && !configured.error) {
      return { data: { id: `${table}-synthetic-id` }, error: null };
    }
    if (configured.data != null || configured.error) return configured;
    if (!operation && table === "user_roles") return { data: [{ user_id: "member-1" }, { user_id: "member-1" }, { user_id: "member-2" }], error: null };
    return configured;
  };
  query.single = vi.fn(async () => resolve());
  query.maybeSingle = vi.fn(async () => resolve());
  Object.defineProperty(query, "then", { value: (ok: any, fail: any) => Promise.resolve(resolve()).then(ok, fail) });
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(queryFor), rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1", email: "person@example.test" }, profile: { display_name: "Test Person" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/memberCheckout", () => ({
  createMemberCheckout: mocks.createCheckout,
  listenForPaymentStatus: mocks.listenForPayment,
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.isNative },
}));
vi.mock("@/lib/safeOpenUrl", () => ({ safeOpenUrl: mocks.safeOpenUrl }));
vi.mock("@/lib/rsvpQueue", () => ({ queueRsvp: mocks.queueRsvp }));
vi.mock("@/lib/earlyRsvpPoints", () => ({ awardEarlyRsvpPoints: mocks.awardPoints }));
vi.mock("@/hooks/useEventGroupMap", () => ({ useEventGroupMap: () => ({ isActive: false, orderedGroups: [], groupOf: () => null }) }));
vi.mock("@/hooks/useEventViews", () => ({ useEventViewTracking: vi.fn() }));
vi.mock("@/hooks/useNotificationNudge", () => ({ useNotificationNudge: () => ({ shouldShowNudge: false, dismiss: vi.fn() }) }));
vi.mock("@/components/event/AttendanceSection", () => ({ AttendanceSection: () => null }));
vi.mock("@/components/EventGuestsManager", () => ({ EventGuestsManager: () => null }));
vi.mock("@/components/EventGroupsManager", () => ({ EventGroupsManager: () => null }));
vi.mock("@/components/events/EventsHeaderSponsorStrip", () => ({ EventsHeaderSponsorStrip: () => null }));
vi.mock("@/components/GoogleMapEmbed", () => ({ GoogleMapEmbed: () => null }));
vi.mock("@/components/event/MatchScoreCard", () => ({ MatchScoreCard: () => null }));
vi.mock("@/components/event/EventNoteSection", () => ({ EventNoteSection: () => null }));
vi.mock("@/components/PostRsvpNotificationPrompt", () => ({ PostRsvpNotificationPrompt: () => null }));
vi.mock("@/components/pitch/PitchBoard", () => ({ default: () => null }));

const baseEvent = {
  id: "event-1", title: "Synthetic match", description: null,
  event_date: "2099-08-10", start_time: "2099-08-10T10:00:00Z",
  end_time: "2099-08-10T11:00:00Z", type: "game", location: "Test Oval",
  club_id: "club-1", team_id: "team-1", mini_league_id: null,
  is_cancelled: false, is_recurring: false, parent_event_id: null,
  rsvp_audience: "all", allow_guests: false, adults_only: false,
  price: null, clubs: { name: "Test Club", sport: "soccer", is_pro: true },
  teams: { name: "U10 Blue", club_id: "club-1" },
};

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/events/event-1"]}>
      <QueryClientProvider client={client}>
        <Routes><Route path="/events/:id" element={children} /></Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const { default: Page } = await import("./EventDetailPage");
  const view = render(<Page />, { wrapper });
  // Child components also use mutations. Parent hooks are registered first and
  // are the stable contract this suite exercises.
  await waitFor(() => expect(mocks.mutations.length).toBeGreaterThanOrEqual(mutationNames.length));
  return view;
}

function mutation(name: string) {
  return mocks.mutations[mutationNames.indexOf(name)];
}

function latestQuery(name: string) {
  return [...mocks.queries].reverse().find((query) => query.queryKey?.[0] === name);
}

describe("EventDetailPage business-operation characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutations = [];
    mocks.operations = [];
    mocks.results = {};
    mocks.isAdmin = true;
    mocks.isAppAdmin = false;
    mocks.eventError = null;
    mocks.eventData = { ...baseEvent };
    mocks.rsvps = [];
    mocks.duties = [];
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
    mocks.payments = [];
    mocks.createCheckout.mockResolvedValue({ error: "checkout unavailable", url: "", payment_id: "" });
    mocks.paymentCallback = null;
    mocks.paymentCleanup.mockReset();
    mocks.listenForPayment.mockImplementation((_paymentId: string, callback: any) => {
      mocks.paymentCallback = callback;
      return mocks.paymentCleanup;
    });
    mocks.isNative = false;
    mocks.safeOpenUrl.mockResolvedValue(undefined);
    mocks.queries = [];
    mocks.queryErrors = {};
    mocks.queryLoading = {};
    mocks.queryFetching = {};
    mocks.queryRefetches = {};
    mocks.awardPoints.mockResolvedValue(undefined);
  });

  it("creates a personal RSVP with an explicit user source and invalidates every dependent view", async () => {
    await renderPage();
    await mutation("rsvp").mutationFn("going");
    expect(mocks.operations).toContainEqual({
      table: "rsvps", kind: "insert",
      payload: { event_id: "event-1", user_id: "user-1", status: "going", notes: null, source: "user" },
      filters: [],
    });

    mutation("rsvp").onSuccess(undefined, "going");
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["event-rsvps", "event-1"] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["event-groups", "event-1"] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["team-members-for-pitch", "team-1", "event-1"] });
  });

  it("distinguishes a missing or inaccessible event from a transient fetch failure", async () => {
    mocks.eventData = null;
    const unavailable = await renderPage();
    expect(screen.getByRole("heading", { name: "Event Not Available" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    unavailable.unmount();

    mocks.mutations = [];
    mocks.queries = [];
    mocks.eventError = { message: "network request failed" };
    await renderPage();
    expect(screen.getByRole("heading", { name: "Couldn't load this event" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["event", "event-1"] });
  });

  it("keeps the loading skeleton while the core event request is pending", async () => {
    mocks.eventData = null;
    mocks.queryLoading.event = true;
    const view = await renderPage();
    expect(screen.queryByRole("heading", { name: "Event Not Available" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Couldn't load this event" })).not.toBeInTheDocument();
    expect(view.container.querySelectorAll("[data-testid='skeleton'], .animate-pulse").length).toBeGreaterThan(0);
  });

  it("does not silently present an empty attendance state when the RSVP read fails", async () => {
    mocks.rsvps = undefined as any;
    mocks.queryErrors["event-rsvps"] = { message: "RSVP read denied", code: "42501" };
    await renderPage();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/attendance.*loaded/i);
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.queryRefetches["event-rsvps"]).toHaveBeenCalledTimes(1);
  });

  it("keeps cached attendance visible when a background RSVP refresh fails", async () => {
    mocks.rsvps = [{
      id: "rsvp-cached",
      event_id: "event-1",
      user_id: "user-1",
      child_id: null,
      status: "going",
      notes: null,
    }];
    mocks.queryErrors["event-rsvps"] = { message: "background refresh failed" };
    mocks.queryFetching["event-rsvps"] = true;
    await renderPage();
    expect(screen.queryByText(/Attendance couldn.t be loaded/i)).not.toBeInTheDocument();
    expect(screen.getByText("Going", { exact: true })).toBeInTheDocument();
  });

  it("updates an existing personal RSVP by its id without creating a duplicate", async () => {
    mocks.rsvps = [{ id: "rsvp-existing", event_id: "event-1", user_id: "user-1", child_id: null, status: "going", notes: "Old note" }];
    await renderPage();
    mocks.results["rsvps:update"] = [{ data: null, error: null }];
    await mutation("rsvp").mutationFn("maybe");
    expect(mocks.operations).toEqual([{
      table: "rsvps", kind: "update",
      payload: { status: "maybe", notes: null, source: "user" },
      filters: [["id", "rsvp-existing"]],
    }]);
  });

  it("creates a child RSVP owned by the guardian with an explicit user source", async () => {
    await renderPage();
    mocks.results["rsvps:insert"] = [{ data: null, error: null }];
    mocks.results["rsvps:select"] = [{ data: { id: "canonical-rsvp" }, error: null }];
    await mutation("childRsvp").mutationFn({ childId: "child-1", status: "going" });
    expect(mocks.operations.at(-1)).toEqual({
      table: "rsvps", kind: "insert",
      payload: { event_id: "event-1", user_id: "user-1", child_id: "child-1", status: "going", source: "user" },
      filters: [],
    });
  });

  it("propagates RSVP database failures instead of reporting a false success", async () => {
    await renderPage();
    const failure = { message: "RLS rejected RSVP", code: "42501" };
    mocks.results["rsvps:insert"] = [{ data: null, error: failure }];
    await expect(mutation("rsvp").mutationFn("going")).rejects.toEqual(failure);
  });

  it("adds duties with normalized event timestamps and never silently drops a write failure", async () => {
    await renderPage();
    await mutation("addDuty").mutationFn({ dutyName: "Canteen/BBQ", startTime: "10:15", endTime: "11:00" });
    expect(mocks.operations.at(-1)?.payload).toMatchObject({
      event_id: "event-1", name: "Canteen/BBQ",
      start_time: "2099-08-10T10:15:00.000Z", end_time: "2099-08-10T11:00:00.000Z",
    });
    const failure = { message: "duty denied" };
    mocks.results["duties:insert"] = [{ data: null, error: failure }];
    await expect(mutation("addDuty").mutationFn({ dutyName: "Referee" })).rejects.toEqual(failure);
  });

  it("cancels one event, posts one team-chat notice, and does not manually duplicate notification rows", async () => {
    await renderPage();
    await mutation("cancelEvent").mutationFn({ cancelType: "single", customMessage: "Ground is flooded", sendPushNotification: true });
    expect(mocks.operations).toContainEqual(expect.objectContaining({
      table: "events", kind: "update",
      payload: { is_cancelled: true, chat_cancel_post_handled: true },
      filters: [["id", "event-1"]],
    }));
    expect(mocks.operations).toContainEqual(expect.objectContaining({
      table: "team_messages", kind: "insert",
      payload: expect.objectContaining({ team_id: "team-1", author_id: "user-1" }),
    }));
    expect(mocks.operations.some((item) => item.table === "notifications")).toBe(false);
  });

  it("stops cancellation before chat side effects when the event update is denied", async () => {
    await renderPage();
    const failure = { message: "not permitted", code: "42501" };
    mocks.results["events:update"] = [{ data: null, error: failure }];
    await expect(mutation("cancelEvent").mutationFn({ cancelType: "single" })).rejects.toEqual(failure);
    expect(mocks.operations.some((item) => item.table === "team_messages")).toBe(false);
  });

  it("treats chat posting as best-effort after a successful cancellation", async () => {
    await renderPage();
    mocks.results["team_messages:insert"] = [{ data: null, error: { message: "chat unavailable" } }];
    await expect(mutation("cancelEvent").mutationFn({ cancelType: "single" })).resolves.toBe(2);
    mutation("cancelEvent").onSuccess();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["event", "event-1"] });
  });

  it("marks a member paid with the exact event ledger contract and removes only that member's payment", async () => {
    mocks.eventData = { ...baseEvent, type: "social", amount: 24.5 };
    await renderPage();
    await mutation("togglePayment").mutationFn({ userId: "member-2", isPaid: false });
    expect(mocks.operations.at(-1)).toEqual({
      table: "event_payments",
      kind: "insert",
      payload: expect.objectContaining({
        event_id: "event-1",
        user_id: "member-2",
        amount: 24.5,
        payment_status: "paid",
        paid_at: expect.any(String),
      }),
      filters: [],
    });

    mocks.operations = [];
    await mutation("togglePayment").mutationFn({ userId: "member-2", isPaid: true });
    expect(mocks.operations).toEqual([{
      table: "event_payments",
      kind: "delete",
      filters: [["event_id", "event-1"], ["user_id", "member-2"]],
    }]);
  });

  it("does not invalidate or report payment success when the ledger write is denied", async () => {
    await renderPage();
    const failure = { message: "payment update denied", code: "42501" };
    mocks.results["event_payments:insert"] = [{ data: null, error: failure }];
    await expect(mutation("togglePayment").mutationFn({ userId: "member-2", isPaid: false })).rejects.toEqual(failure);
    mutation("togglePayment").onError(failure);
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["event-payments", "event-1"] });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Failed to update payment",
      description: "payment update denied",
      variant: "destructive",
    });
  });

  it("claims only the selected duty for the authenticated user", async () => {
    await renderPage();
    await mutation("claimDuty").mutationFn("duty-2");
    expect(mocks.operations).toEqual([{
      table: "duties",
      kind: "update",
      payload: { assigned_to: "user-1" },
      filters: [["id", "duty-2"]],
    }]);
    mutation("claimDuty").onSuccess();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["event-duties", "event-1"] });
  });

  it("reports partial success when duty completion commits but its admin notification fails", async () => {
    mocks.eventData = {
      ...baseEvent,
      event_date: "2020-08-10",
      start_time: "2020-08-10T10:00:00Z",
      end_time: "2020-08-10T11:00:00Z",
    };
    mocks.duties = [{ id: "duty-1", name: "Canteen", status: "open", assigned_to: "user-1" }];
    await renderPage();
    mocks.results["duties:update"] = [{ data: { id: "duty-1" }, error: null }];
    mocks.results["user_roles:select"] = [{
      data: [{ user_id: "user-1" }, { user_id: "admin-2" }, { user_id: "admin-2" }],
      error: null,
    }];
    mocks.results["notifications:insert"] = [{ data: null, error: { message: "notification denied", code: "42501" } }];

    let caught: any;
    try {
      await mutation("completeDuty").mutationFn("duty-1");
    } catch (error) {
      caught = error;
    }
    mutation("completeDuty").onError(caught);
    expect(mocks.operations.find(op => op.table === "duties")?.filters).toEqual([
      ["id", "duty-1"], ["status", "open"],
    ]);
    expect(mocks.operations.find(op => op.table === "notifications")?.payload).toEqual([{
      user_id: "admin-2",
      type: "duty_completed",
      message: "Test Person completed Canteen for Synthetic match",
      related_id: "event-1",
    }]);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Duty completed — notification failed",
      description: expect.stringContaining("notification denied"),
      variant: "destructive",
    }));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["event-duties", "event-1"] });
  });

  it("reports a recurring cancellation as partial when children commit but the parent update fails", async () => {
    mocks.eventData = { ...baseEvent, is_recurring: true };
    await renderPage();
    mocks.results["events:update"] = [
      { data: null, error: null },
      { data: null, error: { message: "parent cancellation denied", code: "42501" } },
    ];
    let caught: any;
    try {
      await mutation("cancelEvent").mutationFn({ cancelType: "series" });
    } catch (error) {
      caught = error;
    }
    mutation("cancelEvent").onError(caught);

    expect(mocks.operations.filter(op => op.table === "events")).toEqual([
      expect.objectContaining({ filters: [["parent_event_id", "event-1"]] }),
      expect.objectContaining({ filters: [["id", "event-1"]] }),
    ]);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Series cancellation incomplete",
      description: expect.stringContaining("parent cancellation denied"),
      variant: "destructive",
    }));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["event", "event-1"] });
  });

  it("reminds only unique non-responders who are outside the cooldown window", async () => {
    await renderPage();
    mocks.results["rsvps:select"] = [{ data: [{ user_id: "member-1" }], error: null }];
    mocks.results["user_roles:select"] = [{
      data: [
        { user_id: "member-1", role: "player" },
        { user_id: "member-2", role: "parent" },
        { user_id: "member-2", role: "coach" },
        { user_id: "member-3", role: "player" },
      ],
      error: null,
    }];
    mocks.results["notifications:select"] = [{ data: [{ user_id: "member-3" }], error: null }];
    const count = await mutation("remind").mutationFn();
    expect(count).toBe(1);
    expect(mocks.operations.find(op => op.table === "notifications")?.payload).toEqual([{
      user_id: "member-2",
      type: "event_reminder",
      message: 'Reminder: Please RSVP for "Synthetic match"',
      related_id: "event-1",
    }]);
  });

  it("does not bulk-remind club members outside a targeted event's invited teams", async () => {
    mocks.eventData = {
      ...baseEvent,
      team_id: null,
      teams: null,
      target_team_ids: ["team-2", "team-3"],
      rsvp_grouping: "team",
    };
    await renderPage();
    mocks.rpc.mockResolvedValueOnce({
      data: [{ user_id: "target-player" }],
      error: null,
    });
    mocks.results["rsvps:select"] = [{ data: [], error: null }];
    mocks.results["user_roles:select"] = [{
      data: [
        { user_id: "target-player", role: "player", team_id: "team-2" },
        { user_id: "uninvited-player", role: "player", team_id: "team-9" },
        { user_id: "club-official", role: "committee_member", team_id: null },
      ],
      error: null,
    }];
    mocks.results["notifications:select"] = [{ data: [], error: null }];

    await mutation("remind").mutationFn();
    expect(mocks.operations.find(op => op.table === "notifications")?.payload).toEqual([{
      user_id: "target-player",
      type: "event_reminder",
      message: 'Reminder: Please RSVP for "Synthetic match"',
      related_id: "event-1",
    }]);
  });

  it("deduplicates a child's primary parent and guardians and skips only recipients in cooldown", async () => {
    await renderPage();
    mocks.results["child_guardians:select"] = [{
      data: [
        { guardian_id: "parent-1" },
        { guardian_id: "guardian-2" },
        { guardian_id: "guardian-2" },
      ],
      error: null,
    }];
    mocks.results["children:select"] = [{ data: { parent_id: "parent-1" }, error: null }];
    mocks.results["notifications:select"] = [{ data: [{ user_id: "guardian-2" }], error: null }];

    const result = await mutation("individualRemind").mutationFn({
      userId: "parent-1",
      childId: "child-1",
      displayName: "Child One",
    });
    expect(result).toEqual({
      displayName: "Child One",
      count: 1,
      isChild: true,
      recipientKey: "parent-1",
    });
    expect(mocks.operations.find(op => op.table === "notifications")?.payload).toEqual([{
      user_id: "parent-1",
      type: "event_reminder",
      message: 'Reminder: Please RSVP for "Synthetic match"',
      related_id: "event-1",
    }]);
  });

  it("does not claim success when a child has no linked parent or guardian", async () => {
    await renderPage();
    mocks.results["child_guardians:select"] = [{ data: [], error: null }];
    mocks.results["children:select"] = [{ data: { parent_id: null }, error: null }];
    await expect(mutation("individualRemind").mutationFn({
      childId: "child-orphan",
      displayName: "Unlinked Child",
    })).rejects.toThrow("Unlinked Child has no linked parents to remind");
    expect(mocks.operations.some(op => op.table === "notifications")).toBe(false);
  });

  it("propagates an individual reminder write failure without reporting success", async () => {
    await renderPage();
    mocks.results["notifications:select"] = [{ data: [], error: null }];
    const denied = { message: "reminder insert denied", code: "42501" };
    mocks.results["notifications:insert"] = [{ data: null, error: denied }];
    await expect(mutation("individualRemind").mutationFn({
      userId: "member-2",
      displayName: "Member Two",
    })).rejects.toEqual(denied);
  });

  it("resends invites only to newly eligible members and pushes only after notification rows commit", async () => {
    mocks.eventData = { ...baseEvent, created_by: "creator-1" };
    await renderPage();
    mocks.results["user_roles:select"] = [{
      data: [
        { user_id: "creator-1", role: "team_admin" },
        { user_id: "member-2", role: "player" },
        { user_id: "member-2", role: "coach" },
        { user_id: "member-3", role: "parent" },
      ],
      error: null,
    }];
    mocks.results["notifications:select"] = [{ data: [{ user_id: "member-3" }], error: null }];
    const count = await mutation("resendInvites").mutationFn();
    expect(count).toBe(1);
    expect(mocks.operations.find(op => op.table === "notifications")?.payload).toEqual([{
      user_id: "member-2",
      type: "event_invite",
      message: "You've been invited to: Synthetic match",
      related_id: "event-1",
      skip_push: true,
    }]);
    expect(mocks.invoke).toHaveBeenCalledWith("send-push-notification", {
      body: expect.objectContaining({
        userId: "member-2",
        url: "/events/event-1",
        notificationType: "event_invite",
      }),
    });
  });

  it("does not resend invites to club members outside a targeted event's invited teams", async () => {
    mocks.eventData = {
      ...baseEvent,
      team_id: null,
      teams: null,
      created_by: "user-1",
      target_team_ids: ["team-2", "team-3"],
      rsvp_grouping: "team",
    };
    await renderPage();
    mocks.rpc.mockResolvedValueOnce({
      data: [{ user_id: "target-player" }],
      error: null,
    });
    mocks.results["user_roles:select"] = [{
      data: [
        { user_id: "target-player", role: "player", team_id: "team-2" },
        { user_id: "uninvited-player", role: "player", team_id: "team-9" },
        { user_id: "club-official", role: "committee_member", team_id: null },
      ],
      error: null,
    }];
    mocks.results["notifications:select"] = [{ data: [], error: null }];

    await mutation("resendInvites").mutationFn();
    expect(mocks.operations.find(op => op.table === "notifications")?.payload).toEqual([{
      user_id: "target-player",
      type: "event_invite",
      message: "You've been invited to: Synthetic match",
      related_id: "event-1",
      skip_push: true,
    }]);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("send-push-notification", {
      body: expect.objectContaining({ userId: "target-player" }),
    });
  });

  it("offers checkout only to an unpaid attendee of a paid social event", async () => {
    mocks.eventData = { ...baseEvent, type: "social", amount: 12.5 };
    mocks.rsvps = [{ id: "rsvp-1", event_id: "event-1", user_id: "user-1", child_id: null, status: "going" }];
    const paidView = await renderPage();
    expect(screen.getByText("Payment Required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay Now" })).toBeInTheDocument();
    paidView.unmount();

    mocks.eventData = { ...baseEvent, type: "social", amount: 0 };
    mocks.mutations = [];
    await renderPage();
    expect(screen.getByText("Synthetic match")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay Now" })).not.toBeInTheDocument();
  });

  it("builds the exact web checkout contract and remains retryable after provider failure", async () => {
    mocks.eventData = { ...baseEvent, type: "social", amount: 19.95 };
    mocks.rsvps = [{ id: "rsvp-1", event_id: "event-1", user_id: "user-1", child_id: null, status: "going" }];
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Pay Now" }));

    await waitFor(() => expect(mocks.createCheckout).toHaveBeenCalledWith({
      club_id: "club-1",
      title: "Synthetic match",
      amount_cents: 1995,
      type: "event",
      payer_email: "person@example.test",
      description: "Event payment: Synthetic match",
      success_url: `${window.location.origin}/events/event-1?payment=success`,
      cancel_url: `${window.location.origin}/events/event-1?payment=cancelled`,
      metadata: { event_id: "event-1", club_id: "club-1", team_id: "team-1" },
    }));
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Payment Error",
      description: "checkout unavailable",
      variant: "destructive",
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay Now" })).toBeEnabled());
  });

  it("prevents repeated taps from creating multiple checkout sessions", async () => {
    let release!: (value: any) => void;
    mocks.createCheckout.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    mocks.eventData = { ...baseEvent, type: "social", amount: 8 };
    mocks.rsvps = [{ id: "rsvp-1", event_id: "event-1", user_id: "user-1", child_id: null, status: "going" }];
    await renderPage();
    const button = screen.getByRole("button", { name: "Pay Now" });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: "Processing..." })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Processing..." }));
    expect(mocks.createCheckout).toHaveBeenCalledTimes(1);
    release({ error: "stopped", url: "", payment_id: "" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay Now" })).toBeEnabled());
  });

  it("uses native deep links, registers one listener and opens the returned URL safely", async () => {
    mocks.isNative = true;
    mocks.createCheckout.mockResolvedValue({
      url: "https://checkout.example.test/session-1",
      payment_id: "payment-1",
    });
    mocks.eventData = { ...baseEvent, type: "social", amount: 11 };
    mocks.rsvps = [{ id: "rsvp-1", event_id: "event-1", user_id: "user-1", child_id: null, status: "going" }];
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Pay Now" }));

    await waitFor(() => expect(mocks.createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      success_url: "igniteclubhq://payment-success",
      cancel_url: "igniteclubhq://payment-cancel",
    })));
    expect(mocks.listenForPayment).toHaveBeenCalledTimes(1);
    expect(mocks.listenForPayment).toHaveBeenCalledWith("payment-1", expect.any(Function));
    await waitFor(() => expect(mocks.safeOpenUrl).toHaveBeenCalledWith("https://checkout.example.test/session-1"));
  });

  it("confirms a paid callback with the exact event contract and refreshes payment state", async () => {
    mocks.isNative = true;
    mocks.createCheckout.mockResolvedValue({ url: "https://checkout.example.test/session-2", payment_id: "payment-2" });
    mocks.eventData = { ...baseEvent, type: "social", amount: 14.75 };
    mocks.rsvps = [{ id: "rsvp-1", event_id: "event-1", user_id: "user-1", child_id: null, status: "going" }];
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Pay Now" }));
    await waitFor(() => expect(mocks.paymentCallback).not.toBeNull());
    await mocks.paymentCallback!("paid");

    expect(mocks.invoke).toHaveBeenCalledWith("confirm-event-payment", {
      body: { event_id: "event-1", amount: 14.75, payment_id: "payment-2" },
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["event-payments", "event-1"] });
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Payment successful!" });
  });

  it("reports a failed terminal callback without confirming or refreshing success state", async () => {
    mocks.isNative = true;
    mocks.createCheckout.mockResolvedValue({ url: "https://checkout.example.test/session-3", payment_id: "payment-3" });
    mocks.eventData = { ...baseEvent, type: "social", amount: 7 };
    mocks.rsvps = [{ id: "rsvp-1", event_id: "event-1", user_id: "user-1", child_id: null, status: "going" }];
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Pay Now" }));
    await waitFor(() => expect(mocks.paymentCallback).not.toBeNull());
    await mocks.paymentCallback!("failed");

    expect(mocks.invoke).not.toHaveBeenCalledWith("confirm-event-payment", expect.anything());
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Payment failed", variant: "destructive" });
  });

  it("does not report payment success when server-side event confirmation returns an error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.isNative = true;
    mocks.createCheckout.mockResolvedValue({ url: "https://checkout.example.test/session-confirm-error", payment_id: "payment-confirm-error" });
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "confirmation denied", code: "42501" } });
    mocks.eventData = { ...baseEvent, type: "social", amount: 16 };
    mocks.rsvps = [{ id: "rsvp-1", event_id: "event-1", user_id: "user-1", child_id: null, status: "going" }];
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Pay Now" }));
    await waitFor(() => expect(mocks.paymentCallback).not.toBeNull());
    await mocks.paymentCallback!("paid");

    expect(mocks.toast).not.toHaveBeenCalledWith({ title: "Payment successful!" });
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["event-payments", "event-1"] });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Payment confirmation incomplete",
      description: "Your payment may have been received, but we could not update the event. Please contact your club before trying again.",
      variant: "destructive",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to confirm event payment server-side:",
      { message: "confirmation denied", code: "42501" },
    );
    consoleError.mockRestore();
  });

  it("reports a missing provider URL and restores checkout so the attendee can retry", async () => {
    mocks.createCheckout.mockResolvedValue({ error: undefined, url: "", payment_id: "payment-without-url" });
    mocks.eventData = { ...baseEvent, type: "social", amount: 6 };
    mocks.rsvps = [{ id: "rsvp-1", event_id: "event-1", user_id: "user-1", child_id: null, status: "going" }];
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Pay Now" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Payment Error",
      description: "No checkout URL returned",
      variant: "destructive",
    }));
    expect(mocks.listenForPayment).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pay Now" })).toBeEnabled();
  });

  it("disposes the active payment listener when Event Detail unmounts", async () => {
    mocks.isNative = true;
    mocks.createCheckout.mockResolvedValue({ url: "https://checkout.example.test/session-4", payment_id: "payment-4" });
    mocks.eventData = { ...baseEvent, type: "social", amount: 9 };
    mocks.rsvps = [{ id: "rsvp-1", event_id: "event-1", user_id: "user-1", child_id: null, status: "going" }];
    const view = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Pay Now" }));
    await waitFor(() => expect(mocks.listenForPayment).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(mocks.paymentCleanup).toHaveBeenCalledTimes(1);
  });

  it("enables the scoped roster only for an administrator of a targeted club-wide event", async () => {
    mocks.eventData = {
      ...baseEvent,
      team_id: null,
      teams: null,
      target_team_ids: ["team-3", "team-2"],
      rsvp_grouping: "team",
    };
    mocks.isAdmin = true;
    await renderPage();

    expect(latestQuery("targeted-event-roster")).toMatchObject({
      queryKey: ["targeted-event-roster", "event-1"],
      enabled: true,
    });
    expect(latestQuery("all-children-on-team")).toMatchObject({
      queryKey: ["all-children-on-team", null, "club-1", false, "all", "team-2,team-3"],
      enabled: true,
    });
    expect(latestQuery("event-payments").enabled).toBe(true);
  });

  it("does not enable manager-only roster or payment reads for an ordinary attendee", async () => {
    mocks.eventData = {
      ...baseEvent,
      team_id: null,
      teams: null,
      target_team_ids: ["team-2"],
      rsvp_grouping: "level",
    };
    mocks.isAdmin = false;
    await renderPage();

    expect(latestQuery("targeted-event-roster").enabled).toBe(false);
    expect(latestQuery("event-payments").enabled).toBe(false);
    expect(screen.queryByText("Delete Event")).not.toBeInTheDocument();
    expect(screen.queryByText("Resend Invites")).not.toBeInTheDocument();
  });

  it("resolves club administrators and committee members as event managers before team-specific checks", async () => {
    for (const role of ["club_admin", "committee_member"]) {
      mocks.mutations = [];
      mocks.queries = [];
      mocks.results = {
        "user_roles:select": [{ data: [{ role }], error: null }],
      };
      const view = await renderPage();
      await expect(latestQuery("event-admin-check").queryFn()).resolves.toBe(true);
      view.unmount();
    }
  });

  it("resolves a team coach as manager only through the matching team role branch", async () => {
    mocks.results["user_roles:select"] = [
      { data: [], error: null },
      { data: [{ role: "coach" }], error: null },
    ];
    await renderPage();
    await expect(latestQuery("event-admin-check").queryFn()).resolves.toBe(true);
  });

  it("resolves mini-league coaches as managers without granting ordinary club members manager access", async () => {
    mocks.eventData = { ...baseEvent, team_id: null, teams: null, mini_league_id: "league-7" };
    mocks.results["user_roles:select"] = [
      { data: [], error: null },
      { data: [{ role: "coach" }], error: null },
    ];
    const managerView = await renderPage();
    await expect(latestQuery("event-admin-check").queryFn()).resolves.toBe(true);
    managerView.unmount();

    mocks.mutations = [];
    mocks.queries = [];
    mocks.results["user_roles:select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    await renderPage();
    await expect(latestQuery("event-admin-check").queryFn()).resolves.toBe(false);
  });

  it("allows the app-admin override to enable sensitive reads without exposing their controls to ordinary attendees", async () => {
    mocks.eventData = {
      ...baseEvent,
      team_id: null,
      teams: null,
      target_team_ids: ["team-2", "team-3"],
      rsvp_grouping: "team",
    };
    mocks.isAdmin = false;
    mocks.isAppAdmin = true;
    await renderPage();

    expect(latestQuery("targeted-event-roster").enabled).toBe(true);
    expect(latestQuery("event-payments").enabled).toBe(true);
  });

  it("offers a targeted RSVP only for the guardian's children assigned to one of the invited teams", async () => {
    mocks.eventData = {
      ...baseEvent,
      team_id: null,
      teams: null,
      target_team_ids: ["team-2", "team-3"],
      rsvp_grouping: "team",
    };
    await renderPage();
    mocks.results["children:select"] = [{
      data: [
        { id: "child-direct", name: "Direct Child" },
        { id: "child-both", name: "Shared Child" },
      ],
      error: null,
    }];
    mocks.results["child_guardians:select"] = [{
      data: [
        { child_id: "child-both", children: { id: "child-both", name: "Shared Child" } },
        { child_id: "child-guardian", children: { id: "child-guardian", name: "Guardian Child" } },
        { child_id: "child-outside", children: { id: "child-outside", name: "Outside Child" } },
      ],
      error: null,
    }];
    mocks.results["child_team_assignments:select"] = [{
      data: [
        { child_id: "child-direct" },
        { child_id: "child-both" },
        { child_id: "child-guardian" },
      ],
      error: null,
    }];

    await expect(latestQuery("children-on-team").queryFn()).resolves.toEqual([
      { id: "child-direct", name: "Direct Child", parent_id: null },
      { id: "child-both", name: "Shared Child", parent_id: null },
      { id: "child-guardian", name: "Guardian Child", parent_id: null },
    ]);
  });

  it("does not offer child RSVP controls for an adults-only event", async () => {
    mocks.eventData = { ...baseEvent, adults_only: true };
    await renderPage();
    await expect(latestQuery("children-on-team").queryFn()).resolves.toEqual([]);
  });

  it("deduplicates a child assigned to more than one targeted team in the attendance roster", async () => {
    mocks.eventData = {
      ...baseEvent,
      team_id: null,
      teams: null,
      target_team_ids: ["team-2", "team-3"],
      rsvp_grouping: "team",
    };
    await renderPage();
    mocks.results["child_team_assignments:select"] = [{
      data: [
        { child_id: "child-shared", children: { id: "child-shared", name: "Shared Player", parent_id: "parent-1" } },
        { child_id: "child-shared", children: { id: "child-shared", name: "Shared Player", parent_id: "parent-1" } },
        { child_id: "child-other", children: { id: "child-other", name: "Other Player", parent_id: "parent-2" } },
      ],
      error: null,
    }];

    await expect(latestQuery("all-children-on-team").queryFn()).resolves.toEqual([
      { id: "child-shared", name: "Shared Player", parent_id: "parent-1" },
      { id: "child-other", name: "Other Player", parent_id: "parent-2" },
    ]);
  });

  it("enables match-only reads for team games but not training, social, club-wide or mini-league events", async () => {
    const cases = [
      { event: { ...baseEvent }, expected: true },
      { event: { ...baseEvent, type: "training" }, expected: false },
      { event: { ...baseEvent, type: "social" }, expected: false },
      { event: { ...baseEvent, team_id: null, teams: null }, expected: false },
      { event: { ...baseEvent, team_id: null, teams: null, mini_league_id: "league-7" }, expected: false },
    ];

    for (const { event, expected } of cases) {
      mocks.mutations = [];
      mocks.queries = [];
      mocks.eventData = event;
      const view = await renderPage();
      const captainMarker = mocks.queries.find((query) =>
        query.queryKey?.[0] === "match-captain" && query.queryKey?.[2] === "marker"
      );
      const playerMarker = mocks.queries.find((query) =>
        query.queryKey?.[0] === "player-of-match" && query.queryKey?.[2] === "marker"
      );
      expect(captainMarker.enabled).toBe(expected);
      expect(playerMarker.enabled).toBe(expected);
      const goalkeeperMarker = mocks.queries.find((query) =>
        query.queryKey?.[0] === "match-goalkeepers" && query.enabled !== undefined
      );
      expect(goalkeeperMarker.enabled).toBe(expected);
      view.unmount();
    }
  });

  it("scopes mini-league attendance and duty reads to the current league and event", async () => {
    mocks.eventData = {
      ...baseEvent,
      team_id: null,
      teams: null,
      mini_league_id: "league-7",
    };
    await renderPage();

    expect(latestQuery("mini-league-players-for-event")).toMatchObject({
      queryKey: ["mini-league-players-for-event", "league-7"],
      enabled: true,
    });
    expect(latestQuery("my-mini-league-players-for-event")).toMatchObject({
      queryKey: ["my-mini-league-players-for-event", "league-7", "user-1"],
      enabled: true,
    });
    expect(latestQuery("mini-league-duty-assignees-session")).toMatchObject({
      queryKey: ["mini-league-duty-assignees-session", "league-7", "event-1"],
      enabled: true,
    });
  });

  it("reopens and deletes only the selected duty, propagating denied writes", async () => {
    await renderPage();
    await mutation("uncompleteDuty").mutationFn("duty-4");
    expect(mocks.operations.at(-1)).toEqual({
      table: "duties",
      kind: "update",
      payload: { status: "open", completed_at: null },
      filters: [["id", "duty-4"]],
    });

    mocks.operations = [];
    const failure = { message: "duty deletion denied", code: "42501" };
    mocks.results["duties:delete"] = [{ data: null, error: failure }];
    await expect(mutation("deleteDuty").mutationFn("duty-9")).rejects.toEqual(failure);
    expect(mocks.operations).toEqual([{
      table: "duties",
      kind: "delete",
      filters: [["id", "duty-9"]],
    }]);
  });

});
