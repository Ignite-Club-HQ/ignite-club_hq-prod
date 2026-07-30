import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capturedPrimaryQuery: null as null | (() => Promise<any>),
  capturedMutations: [] as any[],
  from: vi.fn(),
  rpc: vi.fn(),
  recordPointsHistory: vi.fn(),
  invalidateQueries: vi.fn(),
  refreshProfile: vi.fn(),
  writes: [] as Array<{ table: string; operation: string; payload?: any; filters: any[] }>,
  writeError: null as null | { table: string; operation: string; message: string },
  userChildren: [] as any[],
  tableResults: {} as Record<string, { data: any; error: any }>,
  queryCalls: [] as Array<{ table: string; method: string; args: any[] }>,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: any) => {
      const key = options.queryKey?.[0];
      if (key === "user-memberships-and-events") {
        mocks.capturedPrimaryQuery = options.queryFn;
        return {
          data: { memberships: { teamIds: [], clubIds: [], clubAdminClubIds: [], leagueAdminClubIds: [], miniLeagueIds: [], roles: [] }, events: [] },
          isLoading: false,
          isFetching: false,
          isFetched: true,
        };
      }
      if (key === "user-children-home") return { data: mocks.userChildren, isLoading: false, isFetching: false, isFetched: true };
      return { data: undefined, isLoading: false, isFetching: false, isFetched: true };
    },
    useMutation: (options: any) => {
      mocks.capturedMutations.push(options);
      return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
    },
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: vi.fn() } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1", email: "synthetic@example.test" }, profile: { display_name: "Synthetic User", ignite_points: 0 }, refreshProfile: mocks.refreshProfile, initialized: true }) }));
vi.mock("@/lib/pointsHistory", () => ({ recordPointsHistory: mocks.recordPointsHistory }));
vi.mock("@/hooks/useClubTheme", () => ({ useClubTheme: () => ({ activeClubFilter: null, activeClubTeamIds: [], activeThemeData: null }), hasClubThemeCached: () => false }));
vi.mock("@/hooks/useClubPoints", () => ({ useUserClubPoints: () => ({ data: 0, isLoading: false }), useChildrenClubPoints: () => ({ data: new Map() }) }));
vi.mock("@/hooks/useScheduleBroadcastListener", () => ({ useScheduleBroadcastListener: vi.fn() }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/hooks/useNearbyGameEvent", () => ({ findNearbyGameEvent: () => null }));
vi.mock("@/lib/nextUpEventsCache", () => ({ getCachedNextUp: () => null, setCachedNextUp: vi.fn() }));
vi.mock("@/lib/homeOpenLatency", () => ({ logHomeOpenLatency: vi.fn(), resetHomeOpenLog: vi.fn() }));
vi.mock("@/lib/coldStartMarks", () => ({ mark: vi.fn(), snapshotStages: () => ({}) }));
vi.mock("@/components/NextUpCarousel", () => ({ NextUpCarousel: () => null }));
vi.mock("@/components/MyTeamsPremiumCarousel", () => ({ MyTeamsPremiumCarousel: () => null }));
vi.mock("@/components/MiniLeagueGameWidgets", () => ({ MiniLeagueGameWidgets: () => null }));
vi.mock("@/components/ClubSponsorSection", () => ({ ClubSponsorSection: () => null }));
vi.mock("@/components/MultiClubSponsorCarousel", () => ({ MultiClubSponsorCarousel: () => null }));
vi.mock("@/components/SponsorOrAdCarousel", () => ({ SponsorOrAdCarousel: () => null }));
vi.mock("@/components/UpcomingClassesWidget", () => ({ UpcomingClassesWidget: () => null }));
vi.mock("@/components/HomeQuickActionsFab", () => ({ HomeQuickActionsFab: () => null }));
vi.mock("@/components/home/HomeWelcomeGetStarted", () => ({ HomeWelcomeGetStarted: () => null }));
vi.mock("@/components/club/ClubSetupProgressCard", () => ({ ClubSetupProgressCard: () => null }));
vi.mock("@/components/pitch/GameTimerWidget", () => ({ default: () => null }));
vi.mock("@/components/pitch/PitchBoard", () => ({ default: () => null }));

function queryFor(table: string) {
  const query: any = {};
  const filters: any[] = [];
  let operation = "read";
  for (const method of ["select", "eq", "in", "is", "gte", "order", "limit", "or", "maybeSingle", "single"]) {
    query[method] = vi.fn((...args: any[]) => {
      mocks.queryCalls.push({ table, method, args });
      filters.push([method, ...args]);
      return query;
    });
  }
  query.insert = vi.fn((payload: any) => {
    operation = "insert";
    mocks.writes.push({ table, operation, payload, filters });
    return query;
  });
  query.delete = vi.fn(() => {
    operation = "delete";
    mocks.writes.push({ table, operation, filters });
    return query;
  });
  Object.defineProperty(query, "then", {
    value: (resolve: any, reject: any) => {
      const configuredError = mocks.writeError?.table === table && mocks.writeError.operation === operation
        ? { message: mocks.writeError.message }
        : null;
      const result = operation === "read"
        ? (mocks.tableResults[table] ?? { data: [], error: null })
        : { data: null, error: configuredError };
      return Promise.resolve(result).then(resolve, reject);
    },
  });
  return query;
}

function renderHome() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>
  );
  return import("./HomePage").then(({ default: HomePage }) => render(<HomePage />, { wrapper }));
}

describe("HomePage consolidated membership and event orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capturedPrimaryQuery = null;
    mocks.capturedMutations = [];
    mocks.queryCalls = [];
    mocks.writes = [];
    mocks.writeError = null;
    mocks.userChildren = [];
    mocks.from.mockImplementation(queryFor);
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.recordPointsHistory.mockResolvedValue(undefined);
    mocks.tableResults = {
      user_roles: { data: [], error: null },
      teams: { data: [], error: null },
      mini_league_players: { data: [], error: null },
      mini_leagues: { data: [], error: null },
      events: { data: [], error: null },
      clubs: { data: [], error: null },
    };
  });

  it("scopes, deduplicates and removes soft-deleted membership data", async () => {
    mocks.tableResults.user_roles.data = [
      { role: "club_admin", club_id: "club-active", team_id: null },
      { role: "coach", club_id: "club-active", team_id: "team-active" },
      { role: "player", club_id: "club-active", team_id: "team-active" },
      { role: "club_admin", club_id: "club-deleted", team_id: null },
      { role: "coach", club_id: "club-deleted", team_id: "team-deleted" },
    ];
    mocks.tableResults.teams.data = [{ id: "team-active", club_id: "club-active" }];
    mocks.tableResults.clubs.data = [{ id: "club-active" }];
    mocks.tableResults.events.data = [
      { id: "club-event", title: "Club event", event_date: "2099-07-30T09:00:00Z", start_time: null, club_id: "club-active", team_id: null, mini_league_id: null, is_recurring: false, parent_event_id: null },
      { id: "team-event", title: "Team event", event_date: "2099-07-30T10:00:00Z", start_time: null, club_id: "club-active", team_id: "team-active", mini_league_id: null, is_recurring: false, parent_event_id: null },
      { id: "deleted-club-event", title: "Deleted", event_date: "2099-07-30T11:00:00Z", start_time: null, club_id: "club-deleted", team_id: null, mini_league_id: null, is_recurring: false, parent_event_id: null },
    ];

    await renderHome();
    await waitFor(() => expect(mocks.capturedPrimaryQuery).toBeTypeOf("function"));
    const result = await mocks.capturedPrimaryQuery!();

    expect(result.memberships.teamIds).toEqual(["team-active"]);
    expect(result.memberships.clubIds).toEqual(["club-active"]);
    expect(result.memberships.clubAdminClubIds).toEqual(["club-active"]);
    expect(result.memberships.roles).not.toContainEqual(expect.objectContaining({ club_id: "club-deleted" }));
    expect(result.events.map((item: any) => item.id)).toEqual(["club-event", "team-event"]);

    const scope = mocks.queryCalls.find((call) => call.table === "events" && call.method === "or");
    expect(scope?.args[0]).toContain("club_id.in.(club-active,club-deleted)");
    expect(scope?.args[0]).toContain("team_id.in.(team-active,team-active,team-deleted)");
    expect(mocks.queryCalls).toContainEqual({ table: "events", method: "limit", args: [100] });
  });

  it("throws on role-fetch failure instead of replacing cached dashboard data with empty state", async () => {
    mocks.tableResults.user_roles = { data: null, error: { message: "token rotation" } };
    await renderHome();
    await waitFor(() => expect(mocks.capturedPrimaryQuery).toBeTypeOf("function"));
    await expect(mocks.capturedPrimaryQuery!()).rejects.toEqual({ message: "token rotation" });
  });

  it("throws on event-fetch failure instead of poisoning the cached event list", async () => {
    mocks.tableResults.user_roles.data = [{ role: "player", club_id: "club-active", team_id: "team-active" }];
    mocks.tableResults.teams.data = [{ id: "team-active", club_id: "club-active" }];
    mocks.tableResults.clubs.data = [{ id: "club-active" }];
    mocks.tableResults.events = { data: null, error: { message: "resume race" } };
    await renderHome();
    await waitFor(() => expect(mocks.capturedPrimaryQuery).toBeTypeOf("function"));
    await expect(mocks.capturedPrimaryQuery!()).rejects.toEqual({ message: "resume race" });
  });

  it("throws on active-club validation failure instead of removing every club and protected action", async () => {
    mocks.tableResults.user_roles.data = [{ role: "club_admin", club_id: "club-active", team_id: null }];
    mocks.tableResults.clubs = { data: null, error: { message: "club membership unavailable" } };
    await renderHome();
    await waitFor(() => expect(mocks.capturedPrimaryQuery).toBeTypeOf("function"));
    await expect(mocks.capturedPrimaryQuery!()).rejects.toEqual({ message: "club membership unavailable" });
  });

  it("throws on team validation failure instead of replacing active team membership with an empty set", async () => {
    mocks.tableResults.user_roles.data = [{ role: "coach", club_id: "club-active", team_id: "team-active" }];
    mocks.tableResults.teams = { data: null, error: { message: "team membership unavailable" } };
    mocks.tableResults.clubs.data = [{ id: "club-active" }];
    await renderHome();
    await waitFor(() => expect(mocks.capturedPrimaryQuery).toBeTypeOf("function"));
    await expect(mocks.capturedPrimaryQuery!()).rejects.toEqual({ message: "team membership unavailable" });
  });

  it("throws on player mini-league failure instead of silently removing league events", async () => {
    mocks.tableResults.mini_league_players = { data: null, error: { message: "league membership unavailable" } };
    await renderHome();
    await waitFor(() => expect(mocks.capturedPrimaryQuery).toBeTypeOf("function"));
    await expect(mocks.capturedPrimaryQuery!()).rejects.toEqual({ message: "league membership unavailable" });
  });

  it("throws on league-admin scope failure instead of silently revoking league administration", async () => {
    mocks.tableResults.user_roles.data = [{ role: "league_admin", club_id: "club-active", team_id: null }];
    mocks.tableResults.clubs.data = [{ id: "club-active" }];
    mocks.tableResults.mini_leagues = { data: null, error: { message: "admin league scope unavailable" } };
    await renderHome();
    await waitFor(() => expect(mocks.capturedPrimaryQuery).toBeTypeOf("function"));
    await expect(mocks.capturedPrimaryQuery!()).rejects.toEqual({ message: "admin league scope unavailable" });
  });

  it("treats null successful dependency data as invalid rather than a legitimate empty membership", async () => {
    mocks.tableResults.user_roles.data = [{ role: "player", club_id: "club-active", team_id: "team-active" }];
    mocks.tableResults.teams = { data: null, error: null };
    mocks.tableResults.clubs.data = [{ id: "club-active" }];
    await renderHome();
    await waitFor(() => expect(mocks.capturedPrimaryQuery).toBeTypeOf("function"));
    await expect(mocks.capturedPrimaryQuery!()).rejects.toThrow(/teams fetch returned null data/i);
  });
});

describe("HomePage reward redemption orchestration", () => {
  const reward = {
    id: "reward-1",
    club_id: "club-1",
    name: "Synthetic Reward",
    points_required: 20,
    description: "Test reward",
    sponsors: null,
    show_qr_code: false,
    logo_url: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capturedMutations = [];
    mocks.queryCalls = [];
    mocks.writes = [];
    mocks.writeError = null;
    mocks.userChildren = [];
    mocks.from.mockImplementation(queryFor);
    mocks.tableResults = { clubs: { data: { name: "Synthetic Club", logo_url: null }, error: null } };
    mocks.recordPointsHistory.mockResolvedValue(undefined);
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "redeem_club_reward") return {
        data: {
          redemption_id: "redemption-1", reward_id: "reward-1", club_id: "club-1",
          points_spent: 20, remaining_points: 30, child_id: null, child_name: null,
        },
        error: null,
      };
      return { data: null, error: null };
    });
  });

  async function getRedeemMutation() {
    await renderHome();
    const mutation = mocks.capturedMutations.find((item) =>
      String(item?.mutationFn).includes("redeem_club_reward"),
    );
    if (!mutation) throw new Error("Home reward redemption mutation was not registered");
    return mutation;
  }

  it("rejects insufficient club points before creating a redemption", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "redeem_club_reward"
      ? { data: null, error: { message: "Not enough points" } }
      : { data: null, error: null });
    const mutation = await getRedeemMutation();

    await expect(mutation.mutationFn({ reward, forChildId: null })).rejects.toEqual({ message: "Not enough points" });
    expect(mocks.writes).toEqual([]);
    expect(mocks.recordPointsHistory).not.toHaveBeenCalled();
  });

  it("redeems for the user against the reward club and records the exact remaining balance", async () => {
    const mutation = await getRedeemMutation();
    const result = await mutation.mutationFn({ reward, forChildId: null, idempotencyKey: "attempt-1" });

    expect(mocks.rpc).toHaveBeenCalledWith("redeem_club_reward", {
      _reward_id: "reward-1", _child_id: null, _idempotency_key: "attempt-1",
    });
    expect(result).toEqual(expect.objectContaining({ redemption_id: "redemption-1", remaining_points: 30 }));
    expect(mocks.writes.some((write) => write.table === "reward_redemptions")).toBe(false);
    expect(mocks.recordPointsHistory).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("send_reward_redeemed_email_rpc", expect.objectContaining({
      _points_spent: 20, _remaining_points: 30,
    }));
  });

  it("redeems for a child using only that child's balance in the reward club", async () => {
    mocks.userChildren = [{ id: "child-1", name: "Synthetic Child", ignite_points: 999 }];
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "redeem_club_reward") return {
        data: {
          redemption_id: "redemption-child", reward_id: "reward-1", club_id: "club-1",
          points_spent: 20, remaining_points: 5, child_id: "child-1", child_name: "Synthetic Child",
        },
        error: null,
      };
      return { data: null, error: null };
    });
    const mutation = await getRedeemMutation();
    await mutation.mutationFn({ reward, forChildId: "child-1", idempotencyKey: "attempt-child" });

    expect(mocks.rpc).toHaveBeenCalledWith("redeem_club_reward", {
      _reward_id: "reward-1", _child_id: "child-1", _idempotency_key: "attempt-child",
    });
    expect(mocks.recordPointsHistory).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("send_reward_redeemed_email_rpc", expect.objectContaining({
      _remaining_points: 5, _redeemed_for_child_name: "Synthetic Child",
    }));
  });

  it("stops before points deduction when redemption creation is rejected", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "redeem_club_reward"
      ? { data: null, error: { message: "duplicate redemption" } }
      : { data: null, error: null });
    const mutation = await getRedeemMutation();

    await expect(mutation.mutationFn({ reward, forChildId: null })).rejects.toEqual({ message: "duplicate redemption" });
    expect(mocks.writes).toEqual([]);
    expect(mocks.recordPointsHistory).not.toHaveBeenCalled();
  });

  it("does not leave an orphan redemption if points deduction fails", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "redeem_club_reward"
      ? { data: null, error: { message: "points update failed" } }
      : { data: null, error: null });
    const mutation = await getRedeemMutation();

    await expect(mutation.mutationFn({ reward, forChildId: null })).rejects.toEqual({ message: "points update failed" });
    expect(mocks.writes).toEqual([]);
    expect(mocks.recordPointsHistory).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("send_reward_redeemed_email_rpc", expect.anything());
  });
});
