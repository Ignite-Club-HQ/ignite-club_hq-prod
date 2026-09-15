import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Write = { table: string; kind: "insert" | "update" | "delete"; payload?: any; filters: any[] };

const mocks = vi.hoisted(() => ({
  queries: [] as any[], mutations: [] as any[], writes: [] as Write[],
  queryCalls: [] as Array<{ table: string; method: string; args: any[] }>,
  results: {} as Record<string, Array<{ data: any; error: any }>>,
  userRole: null as string | null,
  isAppAdmin: false,
  teams: [] as any[],
  clubSubscription: null as any,
  clubDeletedAt: null as string | null,
  invalidateQueries: vi.fn(),
  toast: vi.fn(),
  operations: [] as string[],
  invoke: vi.fn(),
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
        club: { id: "club-1", name: "Synthetic Club", sport: "soccer", logo_url: null, deleted_at: mocks.clubDeletedAt },
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
  query.insert = vi.fn((payload: any) => { write = { table, kind: "insert", payload, filters: [] }; mocks.writes.push(write); mocks.operations.push(`${table}:insert`); return query; });
  query.update = vi.fn((payload: any) => { write = { table, kind: "update", payload, filters: [] }; mocks.writes.push(write); mocks.operations.push(`${table}:update`); return query; });
  query.delete = vi.fn(() => { write = { table, kind: "delete", filters: [] }; mocks.writes.push(write); mocks.operations.push(`${table}:delete`); return query; });
  query.eq = vi.fn((column: string, value: any) => { mocks.queryCalls.push({ table, method: "eq", args: [column, value] }); write?.filters.push([column, value]); return query; });
  for (const method of ["in", "is", "gte", "order", "limit", "or"]) query[method] = vi.fn((...args: any[]) => { mocks.queryCalls.push({ table, method, args }); write?.filters.push([method, ...args]); return query; });
  const resolve = () => nextResult(table, write?.kind ?? "select");
  query.single = vi.fn(async () => resolve());
  query.maybeSingle = vi.fn(async () => resolve());
  Object.defineProperty(query, "then", { value: (ok: any, fail: any) => Promise.resolve(resolve()).then(ok, fail) });
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(queryFor), functions: { invoke: mocks.invoke } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1", email: "synthetic@example.test" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useClubProAccess", () => ({ useClubProAccess: () => ({ hasPro: true, hasProFootball: true, isLoading: false }) }));
vi.mock("@/lib/profileCache", () => ({ selectCachedProfileById: async () => ({ data: null }) }));
vi.mock("@/lib/scheduleBroadcast", () => ({ sendScheduleBroadcast: vi.fn() }));
vi.mock("@/lib/clubSetupLocalState", () => ({ clearClubSetupLocalState: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  return {
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
    DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
    DropdownMenuItem: React.forwardRef<HTMLButtonElement, any>(({ children, onClick }, ref) => (
      <button ref={ref} onClick={onClick}>{children}</button>
    )),
  };
});
vi.mock("@/components/ConfirmDeleteDialog", () => ({
  ConfirmDeleteDialog: ({ open, entityType, onConfirm, isLoading, permanent }: any) => open ? (
    <button disabled={isLoading} onClick={onConfirm}>
      {permanent ? `Confirm permanent ${entityType} deletion` : `Confirm ${entityType} deletion`}
    </button>
  ) : null,
}));
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
      <Routes>
        <Route path="/clubs/:id" element={<ClubDetailPage />} />
        <Route path="/clubs" element={<div>Clubs destination</div>} />
      </Routes>
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

async function beginClubDeletion() {
  fireEvent.click(await screen.findByText("Delete Club"));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm club deletion" }));
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
    mocks.clubDeletedAt = null;
    mocks.operations = [];
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
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

  it("cancels billing and commits the club before sending one notification per unique member", async () => {
    mocks.userRole = "club_admin";
    mocks.results["teams:select"] = [{ data: [{ id: "team-1" }, { id: "team-2" }], error: null }];
    mocks.results["user_roles:select"] = [
      { data: [{ user_id: "user-1" }, { user_id: "member-2" }], error: null },
      { data: [{ user_id: "member-2" }, { user_id: "member-3" }], error: null },
    ];
    await renderPage();
    await beginClubDeletion();

    await waitFor(() => expect(mocks.operations).toContain("clubs:update"));
    expect(mocks.invoke).toHaveBeenCalledWith("cancel-subscription", {
      body: { subscription_type: "club", entity_id: "club-1" },
    });
    expect(mocks.operations.indexOf("clubs:update")).toBeLessThan(mocks.operations.indexOf("notifications:insert"));
    expect(mocks.writes.find(write => write.table === "notifications")?.payload).toEqual([
      { user_id: "member-2", type: "membership", message: "Synthetic Club has been deleted", related_id: null },
      { user_id: "member-3", type: "membership", message: "Synthetic Club has been deleted", related_id: null },
    ]);
  });

  it("does not notify or cascade when the club soft-delete is denied", async () => {
    mocks.userRole = "club_admin";
    mocks.results["teams:select"] = [{ data: [{ id: "team-1" }], error: null }];
    mocks.results["user_roles:select"] = [
      { data: [{ user_id: "member-2" }], error: null },
      { data: [], error: null },
    ];
    mocks.results["clubs:update"] = [{ data: null, error: { message: "club delete denied", code: "42501" } }];
    await renderPage();
    await beginClubDeletion();

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Error",
      description: "Failed to delete club: club delete denied",
      variant: "destructive",
    }));
    expect(mocks.writes.some(write => write.table === "notifications")).toBe(false);
    expect(mocks.writes.some(write => write.table === "teams" && write.kind === "update")).toBe(false);
    expect(mocks.writes.some(write => write.table === "chat_groups")).toBe(false);
  });

  it("stops deletion when subscription cancellation cannot be confirmed", async () => {
    mocks.userRole = "club_admin";
    mocks.results["teams:select"] = [{ data: [], error: null }];
    mocks.results["user_roles:select"] = [{ data: [], error: null }];
    mocks.invoke.mockRejectedValue(new Error("Stripe unavailable"));
    await renderPage();
    await beginClubDeletion();

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("cancel-subscription", expect.anything()));
    expect(mocks.writes.some(write => write.table === "clubs" && write.kind === "update")).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Club deletion blocked",
      description: expect.stringContaining("Stripe unavailable"),
      variant: "destructive",
    }));
  });

  it("uses one deletion marker and scopes team and chat cleanup to this club", async () => {
    mocks.userRole = "club_admin";
    mocks.results["teams:select"] = [{ data: [{ id: "team-1" }, { id: "team-2" }], error: null }];
    mocks.results["user_roles:select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    await renderPage();
    await beginClubDeletion();

    await waitFor(() => expect(mocks.writes.some(write => write.table === "chat_groups")).toBe(true));
    const clubWrite = mocks.writes.find(write => write.table === "clubs" && write.kind === "update")!;
    const teamWrite = mocks.writes.find(write => write.table === "teams" && write.kind === "update")!;
    const chatWrite = mocks.writes.find(write => write.table === "chat_groups" && write.kind === "update")!;
    expect(teamWrite.payload.deleted_at).toBe(clubWrite.payload.deleted_at);
    expect(chatWrite.payload.deleted_at).toBe(clubWrite.payload.deleted_at);
    expect(teamWrite.filters).toContainEqual(["in", "id", ["team-1", "team-2"]]);
    expect(chatWrite.filters).toContainEqual(["or", "club_id.eq.club-1,team_id.in.(team-1,team-2)"]);
    expect(chatWrite.filters).toContainEqual(["is", "deleted_at", null]);
  });

  it("restores only rows carrying the club's original deletion marker", async () => {
    mocks.userRole = "club_admin";
    mocks.clubDeletedAt = "2026-07-30T01:02:03.000Z";
    mocks.results["teams:select"] = [{ data: [{ id: "team-1" }], error: null }];
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => expect(mocks.writes.some(write => write.table === "chat_groups")).toBe(true));
    const teamRestore = mocks.writes.find(write => write.table === "teams" && write.payload?.deleted_at === null)!;
    const chatRestore = mocks.writes.find(write => write.table === "chat_groups" && write.payload?.deleted_at === null)!;
    expect(teamRestore.filters).toEqual(expect.arrayContaining([
      ["club_id", "club-1"],
      ["deleted_at", "2026-07-30T01:02:03.000Z"],
    ]));
    expect(chatRestore.filters).toContainEqual(["deleted_at", "2026-07-30T01:02:03.000Z"]);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["club", "club-1"] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["club-teams", "club-1"] });
  });

  it("reports team-cleanup failure as partial deletion rather than complete success", async () => {
    mocks.userRole = "club_admin";
    mocks.results["teams:select"] = [{ data: [{ id: "team-1" }], error: null }];
    mocks.results["user_roles:select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    mocks.results["teams:update"] = [{ data: null, error: { message: "team cleanup denied", code: "42501" } }];
    await renderPage();
    await beginClubDeletion();

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Club deleted — cleanup incomplete",
      description: expect.stringContaining("team cleanup denied"),
      variant: "destructive",
    })));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Club deleted" }));
  });

  it("invokes permanent deletion with the exact club boundary", async () => {
    mocks.userRole = "club_admin";
    mocks.clubDeletedAt = "2026-07-30T01:02:03.000Z";
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Permanently Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm permanent club deletion" }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("permanent-delete-entity", {
      body: { entityType: "club", entityId: "club-1" },
    }));
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Club permanently deleted",
      description: "All data has been removed.",
    });
  });

  it("keys every club-specific read model by the active club and user context", async () => {
    await renderPage();
    const scopedKeys = [
      "club", "club-members-count", "club-members-roles", "club-teams",
      "user-team-memberships", "team-folders", "club-mini-leagues",
      "user-club-role", "pending-invites", "club-team-subscriptions",
      "club-team-sponsors", "club-subscription", "club-request",
    ];
    for (const prefix of scopedKeys) {
      const key = query(prefix).queryKey;
      expect(key, `${prefix} must include club-1`).toContain("club-1");
    }
    expect(query("user-team-memberships").queryKey).toContain("user-1");
    expect(query("user-club-role").queryKey).toContain("user-1");
    expect(query("club-request").queryKey).toContain("user-1");
  });

  it("propagates folder and mini-league failures instead of presenting valid empty sections", async () => {
    await renderPage();
    const folderFailure = { message: "folders unavailable", code: "42501" };
    mocks.results["team_folders:select"] = [{ data: null, error: folderFailure }];
    await expect(query("team-folders").queryFn()).rejects.toEqual(folderFailure);

    const leagueFailure = { message: "leagues unavailable", code: "42501" };
    mocks.results["mini_leagues:select"] = [{ data: null, error: leagueFailure }];
    await expect(query("club-mini-leagues").queryFn()).rejects.toEqual(leagueFailure);
  });

  it("does not convert a failed user-team membership read into an empty membership", async () => {
    mocks.teams = [{ id: "team-1", name: "U10 Blue", is_archived: false }];
    await renderPage();
    const failure = { message: "membership read denied", code: "42501" };
    mocks.results["user_roles:select"] = [{ data: null, error: failure }];
    await expect(query("user-team-memberships").queryFn()).rejects.toEqual(failure);
  });

  it("does not cache a zero member count when its team-scope discovery fails", async () => {
    await renderPage();
    const failure = { message: "team discovery unavailable", code: "42501" };
    mocks.results["teams:select"] = [{ data: null, error: failure }];
    await expect(query("club-members-count").queryFn()).rejects.toEqual(failure);
  });
});
