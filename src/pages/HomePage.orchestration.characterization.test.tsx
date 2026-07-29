import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capturedPrimaryQuery: null as null | (() => Promise<any>),
  from: vi.fn(),
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
      return { data: undefined, isLoading: false, isFetching: false, isFetched: true };
    },
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1", email: "synthetic@example.test" }, profile: { display_name: "Synthetic User", ignite_points: 0 }, refreshProfile: vi.fn(), initialized: true }) }));
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
  for (const method of ["select", "eq", "in", "is", "gte", "order", "limit", "or", "maybeSingle", "single"]) {
    query[method] = vi.fn((...args: any[]) => {
      mocks.queryCalls.push({ table, method, args });
      return query;
    });
  }
  Object.defineProperty(query, "then", {
    value: (resolve: any, reject: any) => Promise.resolve(mocks.tableResults[table] ?? { data: [], error: null }).then(resolve, reject),
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
    mocks.queryCalls = [];
    mocks.from.mockImplementation(queryFor);
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
});
