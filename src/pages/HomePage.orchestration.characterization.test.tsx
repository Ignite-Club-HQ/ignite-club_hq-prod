import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  writeErrors: [] as Array<{ table: string; operation: string; message: string; filter: [string, string, any] }>,
  userChildren: [] as any[],
  primaryData: { memberships: { teamIds: [], clubIds: [], clubAdminClubIds: [], leagueAdminClubIds: [], miniLeagueIds: [], roles: [] }, events: [] } as any,
  tableResults: {} as Record<string, { data: any; error: any }>,
  queryData: {} as Record<string, any>,
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
          data: mocks.primaryData,
          isLoading: false,
          isFetching: false,
          isFetched: true,
        };
      }
      if (key === "user-children-home") return { data: mocks.userChildren, isLoading: false, isFetching: false, isFetched: true };
      return { data: mocks.queryData[key], isLoading: false, isFetching: false, isFetched: true };
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
vi.mock("@/components/MyTeamsPremiumCarousel", async () => {
  const React = await import("react");
  return {
    MyTeamsPremiumCarousel: ({ onReadyChange }: any) => {
      React.useEffect(() => {
        onReadyChange?.(true);
        return () => onReadyChange?.(false);
      }, [onReadyChange]);
      return null;
    },
  };
});
vi.mock("@/components/MiniLeagueGameWidgets", () => ({ MiniLeagueGameWidgets: () => null }));
vi.mock("@/components/ClubSponsorSection", () => ({ ClubSponsorSection: () => null }));
vi.mock("@/components/MultiClubSponsorCarousel", () => ({ MultiClubSponsorCarousel: () => null }));
vi.mock("@/components/SponsorOrAdCarousel", () => ({ SponsorOrAdCarousel: () => null }));
vi.mock("@/components/UpcomingClassesWidget", () => ({ UpcomingClassesWidget: () => null }));
vi.mock("@/components/HomeQuickActionsFab", () => ({
  HomeQuickActionsFab: ({ onJoinTeam }: any) => <button onClick={onJoinTeam}>Open join team</button>,
}));
vi.mock("@/components/MobileCardSelect", () => ({
  MobileCardSelect: ({ value, onValueChange, options, label }: any) => (
    <select aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">Choose</option>
      {(options || []).map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock("@/components/home/HomeWelcomeGetStarted", () => ({ HomeWelcomeGetStarted: () => null }));
vi.mock("@/components/club/ClubSetupProgressCard", () => ({ ClubSetupProgressCard: () => null }));
vi.mock("@/components/pitch/GameTimerWidget", () => ({ default: () => null }));
vi.mock("@/components/pitch/PitchBoard", () => ({ default: () => null }));

function queryFor(table: string) {
  const query: any = {};
  const filters: any[] = [];
  let operation = "read";
  for (const method of ["select", "eq", "in", "is", "gte", "order", "limit", "or", "maybeSingle", "single", "returns"]) {
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
  query.update = vi.fn((payload: any) => {
    operation = "update";
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
        : (() => {
            const errorIndex = mocks.writeErrors.findIndex((candidate) =>
              candidate.table === table
              && candidate.operation === operation
              && filters.some((filter) => filter[0] === candidate.filter[0]
                && filter[1] === candidate.filter[1]
                && filter[2] === candidate.filter[2]),
            );
            if (errorIndex < 0) return null;
            const [matched] = mocks.writeErrors.splice(errorIndex, 1);
            return { message: matched.message };
          })();
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
    mocks.writeErrors = [];
    mocks.userChildren = [];
    mocks.primaryData = { memberships: { teamIds: [], clubIds: [], clubAdminClubIds: [], leagueAdminClubIds: [], miniLeagueIds: [], roles: [] }, events: [] };
    mocks.queryData = {};
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

    const eventScopes = mocks.queryCalls
      .filter((call) => call.table === "events" && call.method === "eq")
      .map((call) => call.args);
    expect(eventScopes).toContainEqual(["club_id", "club-active"]);
    expect(eventScopes).toContainEqual(["club_id", "club-deleted"]);
    expect(eventScopes).toContainEqual(["team_id", "team-active"]);
    expect(eventScopes).toContainEqual(["team_id", "team-deleted"]);
    expect(mocks.queryCalls.filter((call) => call.table === "events" && call.method === "or")).toEqual([]);
    expect(mocks.queryCalls).toContainEqual({ table: "events", method: "limit", args: [30] });
    expect(mocks.queryCalls).toContainEqual({ table: "events", method: "limit", args: [20] });
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
    mocks.writeErrors = [];
    mocks.userChildren = [];
    mocks.primaryData = { memberships: { teamIds: [], clubIds: [], clubAdminClubIds: [], leagueAdminClubIds: [], miniLeagueIds: [], roles: [] }, events: [] };
    mocks.queryData = {};
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

describe("HomePage reward fulfilment orchestration", () => {
  const redemption = {
    id: "redemption-1",
    club_id: "club-1",
    reward_name: "Synthetic Reward",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capturedMutations = [];
    mocks.queryCalls = [];
    mocks.writes = [];
    mocks.writeError = null;
    mocks.writeErrors = [];
    mocks.userChildren = [];
    mocks.primaryData = { memberships: { teamIds: [], clubIds: [], clubAdminClubIds: [], leagueAdminClubIds: [], miniLeagueIds: [], roles: [] }, events: [] };
    mocks.queryData = {};
    mocks.from.mockImplementation(queryFor);
    mocks.tableResults = {
      user_roles: {
        data: [
          { user_id: "user-1" },
          { user_id: "admin-2" },
          { user_id: "admin-3" },
        ],
        error: null,
      },
    };
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  async function getClaimMutation() {
    await renderHome();
    const mutation = mocks.capturedMutations.find((item) =>
      String(item?.mutationFn).includes('from("reward_redemptions")')
      && String(item?.mutationFn).includes('status: "fulfilled"'),
    );
    if (!mutation) throw new Error("Home reward fulfilment mutation was not registered");
    return mutation;
  }

  it("fulfils only the selected redemption and records the authenticated verifier", async () => {
    const mutation = await getClaimMutation();
    await mutation.mutationFn(redemption);

    expect(mocks.writes).toContainEqual(expect.objectContaining({
      table: "reward_redemptions",
      operation: "update",
      payload: expect.objectContaining({ status: "fulfilled", verified_by: "user-1" }),
      filters: expect.arrayContaining([["eq", "id", "redemption-1"]]),
    }));
  });

  it("notifies other club admins once without notifying the claimant", async () => {
    const mutation = await getClaimMutation();
    await mutation.mutationFn(redemption);

    const notificationWrite = mocks.writes.find((write) =>
      write.table === "notifications" && write.operation === "insert",
    );
    expect(notificationWrite?.payload).toEqual([
      expect.objectContaining({ user_id: "admin-2", related_id: "redemption-1" }),
      expect.objectContaining({ user_id: "admin-3", related_id: "redemption-1" }),
    ]);
    expect(notificationWrite?.payload).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: "user-1" }),
    ]));
  });

  it("does not query or notify admins when fulfilment fails", async () => {
    mocks.writeError = { table: "reward_redemptions", operation: "update", message: "fulfilment denied" };
    const mutation = await getClaimMutation();

    await expect(mutation.mutationFn(redemption)).rejects.toEqual({ message: "fulfilment denied" });
    expect(mocks.queryCalls.some((call) => call.table === "user_roles")).toBe(false);
    expect(mocks.writes.some((write) => write.table === "notifications")).toBe(false);
  });

  it("surfaces notification insertion failure instead of reporting complete success", async () => {
    mocks.writeError = { table: "notifications", operation: "insert", message: "notification write failed" };
    const mutation = await getClaimMutation();

    await expect(mutation.mutationFn(redemption)).rejects.toMatchObject({
      message: "The reward was marked as fulfilled, but administrator notifications failed: notification write failed",
      fulfilmentSucceeded: true,
    });
  });

  it("invalidates pending redemptions only after successful fulfilment orchestration", async () => {
    const mutation = await getClaimMutation();
    await mutation.mutationFn(redemption);
    await act(async () => mutation.onSuccess());

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pending-redemptions-home"] });
  });
});


describe("HomePage team and league access-request orchestration", () => {
  const targetTeam = { id: "team-target", name: "U10 Blue", club_id: "club-1", clubs: { name: "Synthetic Club", sport: "soccer" } };
  const targetLeague = { id: "league-1", name: "Mini League", club_id: "club-1", clubs: { name: "Synthetic Club", sport: "soccer" } };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capturedMutations = [];
    mocks.queryCalls = [];
    mocks.writes = [];
    mocks.writeError = null;
    mocks.writeErrors = [];
    mocks.userChildren = [];
    mocks.primaryData = {
      memberships: {
        teamIds: ["team-existing"], clubIds: ["club-1"], clubAdminClubIds: [],
        leagueAdminClubIds: [], miniLeagueIds: [],
        roles: [{ role: "player", team_id: "team-existing", club_id: "club-1" }],
      },
      events: [],
    };
    mocks.queryData = {
      "all-clubs": [{ id: "club-1", name: "Synthetic Club", sport: "soccer", class_mode_enabled: false }],
      "all-teams": [targetTeam],
      "all-mini-leagues": [targetLeague],
      "team-children-for-link": [{ id: "child-1", name: "Synthetic Child" }],
      "pending-role-requests-for-team": [],
    };
    mocks.from.mockImplementation(queryFor);
    mocks.tableResults = {};
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  async function openJoinDialog() {
    await renderHome();
    fireEvent.click(await screen.findByRole("button", { name: "Open join team" }));
    await screen.findByText("Request to Join Team");
  }

  function latestTeamRequestMutation() {
    const mutation = [...mocks.capturedMutations].reverse().find((item) =>
      String(item?.mutationFn).includes("mini_league_id")
      && String(item?.mutationFn).includes("selectedTeamRole"),
    );
    if (!mutation) throw new Error("Home team request mutation was not registered");
    return mutation;
  }

  function latestAdditionalAccessMutation() {
    const mutation = [...mocks.capturedMutations].reverse().find((item) =>
      String(item?.mutationFn).includes('throw new Error("Missing data")')
      && String(item?.mutationFn).includes("teamRoleLabel"),
    );
    if (!mutation) throw new Error("Home additional-access mutation was not registered");
    return mutation;
  }

  it("submits an existing-child parent request with exact team, club and child metadata", async () => {
    await openJoinDialog();
    fireEvent.change(screen.getByLabelText("Select Team"), { target: { value: "team-target" } });
    fireEvent.change(await screen.findByLabelText("Link to Your Child"), { target: { value: "child-1" } });

    await latestTeamRequestMutation().mutationFn();
    expect(mocks.writes).toContainEqual(expect.objectContaining({
      table: "role_requests",
      operation: "insert",
      payload: {
        user_id: "user-1", team_id: "team-target", club_id: "club-1",
        role: "parent", status: "pending",
        metadata: { child_id: "child-1", child_name: "Synthetic Child" },
      },
    }));
  });

  it("trims a new child's name before including it in the parent request", async () => {
    mocks.queryData["team-children-for-link"] = [];
    await openJoinDialog();
    fireEvent.change(screen.getByLabelText("Select Team"), { target: { value: "team-target" } });
    fireEvent.change(await screen.findByPlaceholderText("Enter your child's full name"), { target: { value: "  New Child  " } });

    await latestTeamRequestMutation().mutationFn();
    expect(mocks.writes.find((write) => write.table === "role_requests")?.payload)
      .toEqual(expect.objectContaining({ metadata: { child_name: "New Child" } }));
  });

  it("rejects a parent request when no existing child or new child name is supplied", async () => {
    mocks.queryData["team-children-for-link"] = [];
    await openJoinDialog();
    fireEvent.change(screen.getByLabelText("Select Team"), { target: { value: "team-target" } });

    await expect(latestTeamRequestMutation().mutationFn()).rejects.toThrow(/select your child or add their name/i);
    expect(mocks.writes.some((write) => write.table === "role_requests")).toBe(false);
  });

  it("submits a league request against the league and its owning club", async () => {
    await openJoinDialog();
    fireEvent.change(screen.getByLabelText("Select Team"), { target: { value: "league_league-1" } });

    await latestTeamRequestMutation().mutationFn();
    expect(mocks.writes.find((write) => write.table === "role_requests")?.payload).toEqual({
      user_id: "user-1", mini_league_id: "league-1", club_id: "club-1",
      role: "league_admin", status: "pending",
    });
    expect(mocks.writes.some((write) => write.table === "notifications")).toBe(false);
  });

  it("submits a non-parent team role without child metadata", async () => {
    await openJoinDialog();
    fireEvent.change(screen.getByLabelText("Select Team"), { target: { value: "team-target" } });
    fireEvent.change(screen.getByLabelText("Select Role"), { target: { value: "coach" } });

    await latestTeamRequestMutation().mutationFn();
    expect(mocks.writes.find((write) => write.table === "role_requests")?.payload).toEqual({
      user_id: "user-1", team_id: "team-target", club_id: "club-1",
      role: "coach", status: "pending", metadata: undefined,
    });
  });

  it("rejects a duplicate league role request when that role is already held", async () => {
    mocks.primaryData.memberships.roles = [{ role: "league_admin", team_id: null, club_id: "club-1" }];
    await openJoinDialog();
    fireEvent.change(screen.getByLabelText("Select Team"), { target: { value: "league_league-1" } });

    await expect(latestTeamRequestMutation().mutationFn()).rejects.toThrow(/already have this role in this league/i);
    expect(mocks.writes.some((write) => write.table === "role_requests")).toBe(false);
  });

  it("rejects a duplicate role request when the user already holds that exact team role", async () => {
    mocks.primaryData.memberships.roles = [{ role: "parent", team_id: "team-target", club_id: "club-1" }];
    mocks.primaryData.memberships.teamIds = ["team-target"];
    await openJoinDialog();
    fireEvent.change(screen.getByLabelText("Select Team"), { target: { value: "team-target" } });

    await expect(latestTeamRequestMutation().mutationFn()).rejects.toThrow(/already have this role/i);
    expect(mocks.writes.some((write) => write.table === "role_requests")).toBe(false);
  });

  it("requests additional coach access without replacing the user's existing role", async () => {
    mocks.primaryData.memberships.roles = [{ role: "player", team_id: "team-target", club_id: "club-1" }];
    mocks.primaryData.memberships.teamIds = ["team-target"];
    await openJoinDialog();
    fireEvent.change(screen.getByLabelText("Select Team"), { target: { value: "team-target" } });

    await latestAdditionalAccessMutation().mutationFn("coach");
    expect(mocks.writes.find((write) => write.table === "role_requests")?.payload).toEqual({
      user_id: "user-1", team_id: "team-target", club_id: "club-1", role: "coach", status: "pending",
    });
    expect(mocks.writes.some((write) => write.operation === "delete" || write.operation === "update")).toBe(false);
  });

  it("renders a pending elevated request as non-submittable", async () => {
    mocks.primaryData.memberships.roles = [{ role: "player", team_id: "team-target", club_id: "club-1" }];
    mocks.primaryData.memberships.teamIds = ["team-target"];
    mocks.queryData["pending-role-requests-for-team"] = ["coach"];
    await openJoinDialog();
    fireEvent.change(screen.getByLabelText("Select Team"), { target: { value: "team-target" } });

    const coachRequestRow = (await screen.findByText("Request Coach Access")).closest("div.flex");
    expect(coachRequestRow).not.toBeNull();
    expect(within(coachRequestRow!).getByText("Pending")).toBeTruthy();
    expect(within(coachRequestRow!).queryByRole("button")).toBeNull();
  });

  it("surfaces database rejection and performs no client-side notification insert", async () => {
    mocks.writeError = { table: "role_requests", operation: "insert", message: "request denied" };
    await openJoinDialog();
    fireEvent.change(screen.getByLabelText("Select Team"), { target: { value: "league_league-1" } });

    await expect(latestTeamRequestMutation().mutationFn()).rejects.toEqual({ message: "request denied" });
    expect(mocks.writes.some((write) => write.table === "notifications")).toBe(false);
  });

  it("invalidates both access-request views only after successful additional-access submission", async () => {
    mocks.primaryData.memberships.roles = [{ role: "player", team_id: "team-target", club_id: "club-1" }];
    mocks.primaryData.memberships.teamIds = ["team-target"];
    await openJoinDialog();
    fireEvent.change(screen.getByLabelText("Select Team"), { target: { value: "team-target" } });
    const mutation = latestAdditionalAccessMutation();
    await mutation.mutationFn("coach");
    await act(async () => mutation.onSuccess(undefined, "coach"));

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pending-role-requests-for-team", "user-1", "team-target"] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["role-requests"] });
  });
});
