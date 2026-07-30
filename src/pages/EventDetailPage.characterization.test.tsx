import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
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
  eventError: null as any,
  eventData: null as any,
  rsvps: [] as any[],
}));

const mutationNames = [
  "parentLeaguePlayerRsvp", "rsvp", "childRsvp", "adminRsvp",
  "adminUpdateRsvp", "rsvpForMember", "rsvpForChild", "togglePayment",
  "addDuty", "claimDuty", "completeDuty", "uncompleteDuty", "deleteDuty",
  "assignDuty", "deleteEvent", "cancelEvent", "remind", "individualRemind",
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
      const key = options.queryKey?.[0];
      const values: Record<string, any> = {
        event: mocks.eventData,
        "event-rsvps": mocks.rsvps, "event-guests": [], "event-duties": [],
        "is-app-admin": false, "event-admin-check": mocks.isAdmin,
        "team-pro-football-status": true, "team-pro-status": true,
        "event-subs-manager-direct": false, "is-team-member": true,
        "active-game-summary": null, "team-members-for-pitch": [],
        "team-subscription-for-pitch": null, "event-members-with-roles": [],
        "mini-league-players-for-event": [], "mini-league-adults-for-event": [],
        "my-mini-league-players-for-event": [], "mini-league-duty-assignees-session": [],
        "children-on-team": [], "targeted-event-roster": [],
        "child-guardians-on-team": [], "event-payments": [],
        "match-captain": null, "player-of-match": null, "match-goalkeepers": [],
        "event-recent-reminders": new Map(),
      };
      return {
        data: values[key], error: key === "event" ? mocks.eventError : null,
        isLoading: false, isFetching: false, isFetched: true, refetch: vi.fn(),
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
    if (!operation && table === "user_roles") return { data: [{ user_id: "member-1" }, { user_id: "member-1" }, { user_id: "member-2" }], error: null };
    return configured;
  };
  query.single = vi.fn(async () => resolve());
  query.maybeSingle = vi.fn(async () => resolve());
  Object.defineProperty(query, "then", { value: (ok: any, fail: any) => Promise.resolve(resolve()).then(ok, fail) });
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(queryFor), rpc: mocks.rpc, functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1", email: "person@example.test" }, profile: { display_name: "Test Person" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
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
  render(<Page />, { wrapper });
  // Child components also use mutations. Parent hooks are registered first and
  // are the stable contract this suite exercises.
  await waitFor(() => expect(mocks.mutations.length).toBeGreaterThanOrEqual(mutationNames.length));
}

function mutation(name: string) {
  return mocks.mutations[mutationNames.indexOf(name)];
}

describe("EventDetailPage business-operation characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutations = [];
    mocks.operations = [];
    mocks.results = {};
    mocks.isAdmin = true;
    mocks.eventError = null;
    mocks.eventData = { ...baseEvent };
    mocks.rsvps = [];
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
});
