import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Write = { table: string; kind: "insert" | "update" | "delete"; payload?: any; filters: Array<[string, any]> };

const mocks = vi.hoisted(() => ({
  queries: [] as any[], mutations: [] as any[], writes: [] as Write[],
  queryCalls: [] as Array<{ table: string; method: string; args: any[] }>,
  results: {} as Record<string, Array<{ data: any; error: any }>>,
  userRole: null as string | null,
  isAppAdmin: false,
  teams: [] as any[],
  clubSubscription: null as any,
  invalidateQueries: vi.fn(),
  toast: vi.fn(),
}));

const mutationNames = ["moveTeam", "createFolder", "updateFolder", "deleteFolder", "requestRole", "toggleClubPro"];

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
    useQuery: (options: any) => {
      mocks.queries.push(options);
      const key = options.queryKey?.[0];
      const values: Record<string, any> = {
        club: { id: "club-1", name: "Synthetic Club", sport: "soccer", logo_url: null, deleted_at: null },
        "club-members-count": { adults: 3, juniors: 4, total: 7, newThisMonth: 1 },
        "club-members-roles": [],
        "club-teams": mocks.teams,
        "user-team-memberships": [],
        "team-folders": [],
        "club-mini-leagues": [],
        "user-club-role": mocks.userRole,
        "is-app-admin": mocks.isAppAdmin,
        "pending-invites": [],
        "club-team-subscriptions": [],
        "club-team-sponsors": [],
        "club-subscription": mocks.clubSubscription,
        "club-request": null,
      };
      return {
        data: values[key], error: null, isLoading: false, isFetching: false,
        isFetched: true, refetch: vi.fn(),
      };
    },
    useMutation: (options: any) => {
      mocks.mutations.push(options);
      return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
    },
  };
});

function nextResult(table: string, kind: string) {
  return mocks.results[`${table}:${kind}`]?.shift() ?? { data: null, error: null };
}

function queryFor(table: string) {
  let write: Write | null = null;
  const query: any = {};
  query.select = vi.fn((...args: any[]) => { mocks.queryCalls.push({ table, method: "select", args }); return query; });
  query.insert = vi.fn((payload: any) => { write = { table, kind: "insert", payload, filters: [] }; mocks.writes.push(write); return query; });
  query.update = vi.fn((payload: any) => { write = { table, kind: "update", payload, filters: [] }; mocks.writes.push(write); return query; });
  query.delete = vi.fn(() => { write = { table, kind: "delete", filters: [] }; mocks.writes.push(write); return query; });
  query.eq = vi.fn((column: string, value: any) => { mocks.queryCalls.push({ table, method: "eq", args: [column, value] }); write?.filters.push([column, value]); return query; });
  for (const method of ["in", "is", "order", "limit", "or"]) query[method] = vi.fn((...args: any[]) => { mocks.queryCalls.push({ table, method, args }); return query; });
  const resolve = () => nextResult(table, write?.kind ?? "select");
  query.single = vi.fn(async () => resolve());
  query.maybeSingle = vi.fn(async () => resolve());
  Object.defineProperty(query, "then", { value: (ok: any, fail: any) => Promise.resolve(resolve()).then(ok, fail) });
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(queryFor), functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1", email: "synthetic@example.test" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useClubProAccess", () => ({ useClubProAccess: () => ({ hasPro: true, hasProFootball: true, isLoading: false }) }));
vi.mock("@/lib/profileCache", () => ({ selectCachedProfileById: async () => ({ data: null }) }));
vi.mock("@/lib/scheduleBroadcast", () => ({ sendScheduleBroadcast: vi.fn() }));
vi.mock("@/components/club/ClubSetupProgressCard", () => ({ ClubSetupProgressCard: () => null }));
vi.mock("@/components/SponsorsManager", () => ({ SponsorsManager: () => null }));
vi.mock("@/components/ClubRewardsManager", () => ({ default: () => null }));
vi.mock("@/components/PrimarySponsorDisplay", () => ({ PrimarySponsorDisplay: () => null }));
vi.mock("@/components/ClubTeamSponsorAllocator", () => ({ ClubTeamSponsorAllocator: () => null }));
vi.mock("@/components/PendingTeamRequests", () => ({ PendingTeamRequests: () => null }));
vi.mock("@/components/ClubThemeEditor", () => ({ ClubThemeEditor: () => null }));
vi.mock("@/components/ClubDMSettings", () => ({ ClubDMSettings: () => null }));
vi.mock("@/components/ClubMessagePrivacySettings", () => ({ ClubMessagePrivacySettings: () => null }));
vi.mock("@/components/ClubAICatchUpSettings", () => ({ ClubAICatchUpSettings: () => null }));
vi.mock("@/components/TermsManager", () => ({ TermsManager: () => null }));
vi.mock("@/components/AdminEnrolmentManager", () => ({ AdminEnrolmentManager: () => null }));
vi.mock("@/components/ClassAttendanceManager", () => ({ ClassAttendanceManager: () => null }));
vi.mock("@/components/ClassModeOnboardingGuide", () => ({ ClassModeOnboardingGuide: () => null }));
vi.mock("@/components/TodaysClassesDashboard", () => ({ TodaysClassesDashboard: () => null }));
vi.mock("@/components/history/ClubRecentGames", () => ({ default: () => null }));
vi.mock("@/components/competitions/ClubCompetitionsSection", () => ({ default: () => null }));

async function renderPage() {
  const { default: ClubDetailPage } = await import("./ClubDetailPage");
  render(
    <MemoryRouter initialEntries={["/clubs/club-1"]}>
      <Routes><Route path="/clubs/:id" element={<ClubDetailPage />} /></Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(mocks.mutations.length).toBeGreaterThanOrEqual(mutationNames.length));
}

function mutation(name: string) {
  return mocks.mutations[mutationNames.indexOf(name)];
}

function query(key: string) {
  return [...mocks.queries].reverse().find((options) => options.queryKey?.[0] === key);
}

describe("ClubDetailPage administration characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queries = [];
    mocks.mutations = [];
    mocks.writes = [];
    mocks.queryCalls = [];
    mocks.results = {};
    mocks.userRole = null;
    mocks.isAppAdmin = false;
    mocks.teams = [];
    mocks.clubSubscription = null;
  });

  it("loads only non-deleted teams belonging to the current club and surfaces query failures", async () => {
    await renderPage();
    mocks.results["teams:select"] = [{ data: [], error: null }];
    await query("club-teams").queryFn();
    expect(mocks.queryCalls).toEqual(expect.arrayContaining([
      { table: "teams", method: "eq", args: ["club_id", "club-1"] },
      { table: "teams", method: "is", args: ["deleted_at", null] },
      { table: "teams", method: "order", args: ["name"] },
    ]));

    const failure = { message: "club teams denied", code: "42501" };
    mocks.results["teams:select"] = [{ data: null, error: failure }];
    await expect(query("club-teams").queryFn()).rejects.toEqual(failure);
  });

  it("enables pending-invite administration only for club or app administrators", async () => {
    await renderPage();
    expect(query("pending-invites").enabled).toBe(false);

    mocks.queries = [];
    mocks.mutations = [];
    mocks.userRole = "club_admin";
    await renderPage();
    expect(query("pending-invites").enabled).toBe(true);
  });

  it("shows archived teams only to administrators", async () => {
    mocks.teams = [{ id: "team-old", name: "U10 2025", is_archived: true, logo_url: null }];
    await renderPage();
    expect(screen.queryByText("Archived Teams")).not.toBeInTheDocument();

    mocks.queries = [];
    mocks.mutations = [];
    mocks.userRole = "club_admin";
    await renderPage();
    expect(screen.getByText("Archived Teams")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Archived Teams"));
    expect(screen.getByText("Reinstate")).toBeInTheDocument();
  });

  it("moves only the selected team and invalidates the club team list", async () => {
    await renderPage();
    await mutation("moveTeam").mutationFn({ teamId: "team-1", folderId: "folder-2" });
    expect(mocks.writes).toEqual([{
      table: "teams", kind: "update", payload: { folder_id: "folder-2" }, filters: [["id", "team-1"]],
    }]);
    mutation("moveTeam").onSuccess();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["club-teams", "club-1"] });
  });

  it("creates folders in the current club with normalized optional fields", async () => {
    await renderPage();
    await mutation("createFolder").mutationFn({ name: "Junior Teams", description: "", color: "blue" });
    expect(mocks.writes.at(-1)).toEqual({
      table: "team_folders", kind: "insert",
      payload: { club_id: "club-1", name: "Junior Teams", description: null, color: "blue", sort_order: 0, created_by: "user-1" },
      filters: [],
    });
  });

  it("deleting a folder refreshes both folders and team placement while failures propagate", async () => {
    await renderPage();
    await mutation("deleteFolder").mutationFn("folder-1");
    expect(mocks.writes.at(-1)).toEqual({ table: "team_folders", kind: "delete", filters: [["id", "folder-1"]] });
    mutation("deleteFolder").onSuccess();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["team-folders", "club-1"] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["club-teams", "club-1"] });

    const failure = { message: "folder contains protected teams", code: "42501" };
    mocks.results["team_folders:delete"] = [{ data: null, error: failure }];
    await expect(mutation("deleteFolder").mutationFn("folder-2")).rejects.toEqual(failure);
  });

  it("submits one scoped role request without duplicating trigger-owned notifications", async () => {
    await renderPage();
    await mutation("requestRole").mutationFn();
    expect(mocks.writes).toEqual([{
      table: "role_requests", kind: "insert",
      payload: { user_id: "user-1", club_id: "club-1", role: "club_admin" }, filters: [],
    }]);
    expect(mocks.writes.some((write) => write.table === "notifications")).toBe(false);
  });

  it("updates an existing club subscription without touching team subscriptions", async () => {
    mocks.clubSubscription = { club_id: "club-1", is_pro: false, is_pro_football: false };
    await renderPage();
    await mutation("toggleClubPro").mutationFn({ isPro: true, isProFootball: false });
    expect(mocks.writes).toHaveLength(1);
    expect(mocks.writes[0]).toMatchObject({
      table: "club_subscriptions", kind: "update",
      payload: expect.objectContaining({ is_pro: true, is_pro_football: false, expires_at: null }),
      filters: [["club_id", "club-1"]],
    });
    expect(mocks.writes.some((write) => write.table === "team_subscriptions")).toBe(false);
  });

  it("creates a missing club subscription and propagates RLS rejection", async () => {
    await renderPage();
    await mutation("toggleClubPro").mutationFn({ isPro: true, isProFootball: true });
    expect(mocks.writes.at(-1)).toMatchObject({
      table: "club_subscriptions", kind: "insert",
      payload: expect.objectContaining({ club_id: "club-1", is_pro: true, is_pro_football: true, plan: "unlimited" }),
    });

    const failure = { message: "app admin required", code: "42501" };
    mocks.results["club_subscriptions:insert"] = [{ data: null, error: failure }];
    await expect(mutation("toggleClubPro").mutationFn({ isPro: true, isProFootball: false })).rejects.toEqual(failure);
  });
});
