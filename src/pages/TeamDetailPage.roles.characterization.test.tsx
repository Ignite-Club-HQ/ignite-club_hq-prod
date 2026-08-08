import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  teamRoles: [] as string[],
  isClubAdmin: false,
  isAppAdmin: false,
  deletedAt: null as string | null,
  toast: vi.fn(),
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
  writes: [] as Array<{ table: string; kind: string; payload?: any; filters: any[] }>,
  operations: [] as string[],
  results: {} as Record<string, Array<{ data: any; error: any }>>,
  invoke: vi.fn(),
  queries: [] as any[],
  rpc: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: any) => {
      mocks.queries.push(options);
      const key = options.queryKey?.[0];
      if (key === "team") return { data: { id: "team-1", name: "Synthetic Team", club_id: "club-1", team_type: "senior", is_pro: false, deleted_at: mocks.deletedAt, clubs: { id: "club-1", name: "Synthetic Club", sport: "soccer", class_mode_enabled: false } }, isLoading: false, isFetching: false, fetchStatus: "idle" };
      if (key === "user-team-roles") return {
        data: mocks.teamRoles.map((role) => ({ role, via_captain: false })),
        isLoading: false,
        isFetching: false,
      };
      if (key === "is-club-admin") return { data: mocks.isClubAdmin, isLoading: false, isFetching: false };
      if (key === "is-app-admin") return { data: mocks.isAppAdmin, isLoading: false, isFetching: false };
      if (key === "team-roles" || key === "team-children" || key === "pending-team-invites") return { data: [], isLoading: false, isFetching: false, refetch: vi.fn() };
      if (key === "club-subscription" || key === "team-subscription") return { data: null, isLoading: false, isFetching: false };
      return { data: undefined, isLoading: false, isFetching: false, fetchStatus: "idle", refetch: vi.fn() };
    },
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
      setQueryData: mocks.setQueryData,
    }),
  };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
function supabaseQuery(table: string) {
  let kind = "select";
  let write: { table: string; kind: string; payload?: any; filters: any[] } | null = null;
  const query: any = {};
  query.select = vi.fn(() => { kind = "select"; return query; });
  query.insert = vi.fn((payload: any) => {
    kind = "insert";
    write = { table, kind, payload, filters: [] };
    mocks.writes.push(write);
    mocks.operations.push(`${table}:insert`);
    return query;
  });
  query.update = vi.fn((payload: any) => {
    kind = "update";
    write = { table, kind, payload, filters: [] };
    mocks.writes.push(write);
    mocks.operations.push(`${table}:update`);
    return query;
  });
  query.delete = vi.fn(() => {
    kind = "delete";
    write = { table, kind, filters: [] };
    mocks.writes.push(write);
    mocks.operations.push(`${table}:delete`);
    return query;
  });
  for (const method of ["eq", "in", "gte", "is", "or", "order", "limit"]) {
    query[method] = vi.fn((...args: any[]) => {
      write?.filters.push([method, ...args]);
      return query;
    });
  }
  const resolve = () => mocks.results[`${table}:${kind}`]?.shift() ?? { data: [], error: null };
  query.single = vi.fn(async () => resolve());
  query.maybeSingle = vi.fn(async () => resolve());
  Object.defineProperty(query, "then", {
    value: (ok: any, fail: any) => Promise.resolve(resolve()).then(ok, fail),
  });
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(supabaseQuery), rpc: mocks.rpc, functions: { invoke: mocks.invoke } },
}));
vi.mock("@/hooks/useNearbyGameEvent", () => ({ findNearbyGameEvent: vi.fn().mockResolvedValue(null) }));
vi.mock("@/components/pitch/PitchBoard", () => ({ default: () => null }));
vi.mock("@/components/team/TeamNextEventCard", () => ({ TeamNextEventCard: () => null }));
vi.mock("@/components/team/TeamRankCard", () => ({ TeamRankCard: () => null }));
vi.mock("@/components/team/TeamNextStepsCard", () => ({ TeamNextStepsCard: () => null }));
vi.mock("@/components/team/TeamLatestPhotos", () => ({ TeamLatestPhotos: () => null }));
vi.mock("@/components/team/TeamChatPreview", () => ({ TeamChatPreview: () => null }));
vi.mock("@/components/competitions/TeamCompetitionsSection", () => ({ default: () => null }));
vi.mock("@/components/MemberSubscriptionPaymentsManager", () => ({ default: () => null }));
vi.mock("@/components/PrimarySponsorDisplay", () => ({ PrimarySponsorDisplay: () => null }));
vi.mock("@/components/TeamSponsorSelector", () => ({ TeamSponsorSelector: () => null }));
vi.mock("@/components/TeamRewardsManager", () => ({ default: () => null }));
vi.mock("@/components/chat/ChatGroupsList", () => ({ default: () => null }));
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  return {
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
    DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
    DropdownMenuItem: React.forwardRef<HTMLButtonElement, any>(({ children, onClick }, ref) => (
      <button ref={ref} onClick={onClick}>{children}</button>
    )),
    DropdownMenuSeparator: () => <hr />,
  };
});
vi.mock("@/components/ArchiveTeamDialog", () => ({
  ArchiveTeamDialog: ({ trigger }: any) => trigger,
}));
vi.mock("@/components/ConfirmDeleteDialog", () => ({
  ConfirmDeleteDialog: ({ open, entityType, onConfirm, isLoading, permanent }: any) => open ? (
    <button disabled={isLoading} onClick={onConfirm}>
      {permanent ? `Confirm permanent ${entityType} deletion` : `Confirm ${entityType} deletion`}
    </button>
  ) : null,
}));

import TeamDetailPage from "./TeamDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/teams/team-1"]}>
      <Routes>
        <Route path="/teams/:id" element={<TeamDetailPage />} />
        <Route path="/clubs/:id" element={<div>Club destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TeamDetailPage role-aware rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.teamRoles = [];
    mocks.isClubAdmin = false;
    mocks.isAppAdmin = false;
    mocks.deletedAt = null;
    mocks.writes = [];
    mocks.operations = [];
    mocks.results = {};
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
    mocks.queries = [];
    mocks.rpc.mockResolvedValue({ data: [], error: null });
  });

  it("shows a player the team without exposing management actions", async () => {
    mocks.teamRoles = ["player"];
    renderPage();
    expect(await screen.findByRole("heading", { name: "Synthetic Team" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Team options menu" })).not.toBeInTheDocument();
  });

  it("shows a coach the invite and team-management entry points", async () => {
    mocks.teamRoles = ["coach"];
    renderPage();
    expect(await screen.findByRole("button", { name: "Invite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Team options menu" })).toBeInTheDocument();
  });

  it("gives the team's club administrator the same management entry points", async () => {
    mocks.isClubAdmin = true;
    renderPage();
    expect(await screen.findByRole("button", { name: "Invite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Team options menu" })).toBeInTheDocument();
  });

  it("does not expose management actions to an unrelated user", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Synthetic Team" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Team options menu" })).not.toBeInTheDocument();
  });

  it("lets a club administrator restore a deleted team they manage", async () => {
    mocks.isClubAdmin = true;
    mocks.deletedAt = "2026-07-01T00:00:00Z";
    renderPage();
    expect(await screen.findByText(/Will be permanently deleted after 30 days/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("restores only the selected team and refreshes its detail cache", async () => {
    mocks.isClubAdmin = true;
    mocks.deletedAt = "2026-07-01T00:00:00Z";
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => expect(mocks.writes).toContainEqual({
      table: "teams",
      kind: "update",
      payload: { deleted_at: null, deleted_by: null },
      filters: [["eq", "id", "team-1"]],
    }));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["team", "team-1"] });
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Team restored!" });
  });

  it("does not report or cache a restore when the team update is denied", async () => {
    mocks.isClubAdmin = true;
    mocks.deletedAt = "2026-07-01T00:00:00Z";
    mocks.results["teams:update"] = [{ data: null, error: { message: "restore denied", code: "42501" } }];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Error",
      description: "Failed to restore team.",
      variant: "destructive",
    }));
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["team", "team-1"] });
  });

  it("does not announce deletion success when the team soft-delete is denied", async () => {
    mocks.isClubAdmin = true;
    mocks.results["user_roles:select"] = [{ data: [], error: null }];
    mocks.results["teams:update"] = [{ data: null, error: { message: "delete denied", code: "42501" } }];
    renderPage();
    fireEvent.click(await screen.findByText("Delete Team"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm team deletion" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Error",
      description: "Failed to delete team.",
      variant: "destructive",
    }));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Team deleted" }));
    const invalidatedRoots = mocks.invalidateQueries.mock.calls.map(
      ([filters]) => filters?.queryKey?.[0],
    );
    expect(invalidatedRoots).not.toEqual(expect.arrayContaining([
      "club-teams-for-event",
      "all-club-teams-for-target",
      "user-teams-upload-sheet",
      "media-filter-teams",
      "vault-club-teams",
    ]));
  });

  it("commits the team deletion before telling members that it was deleted", async () => {
    mocks.isClubAdmin = true;
    mocks.results["user_roles:select"] = [{
      data: [{ user_id: "user-1" }, { user_id: "member-2" }, { user_id: "member-3" }],
      error: null,
    }];
    renderPage();
    fireEvent.click(await screen.findByText("Delete Team"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm team deletion" }));

    await waitFor(() => expect(mocks.operations).toContain("teams:update"));
    expect(mocks.operations.indexOf("teams:update")).toBeLessThan(mocks.operations.indexOf("notifications:insert"));
    expect(mocks.writes.find(write => write.table === "notifications")?.payload).toEqual([
      { user_id: "member-2", type: "membership", message: "Synthetic Team has been deleted", related_id: "club-1" },
      { user_id: "member-3", type: "membership", message: "Synthetic Team has been deleted", related_id: "club-1" },
    ]);
  });

  it("evicts every event, Gallery and Vault team picker after a team deletion commits", async () => {
    mocks.isClubAdmin = true;
    mocks.results["user_roles:select"] = [{ data: [], error: null }];
    renderPage();
    fireEvent.click(await screen.findByText("Delete Team"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm team deletion" }));

    await waitFor(() => expect(mocks.operations).toContain("teams:update"));

    const invalidatedRoots = mocks.invalidateQueries.mock.calls.map(
      ([filters]) => filters?.queryKey?.[0],
    );
    expect(invalidatedRoots).toEqual(expect.arrayContaining([
      "club-teams-for-event",
      "all-club-teams-for-target",
      "user-teams-upload-sheet",
      "media-filter-teams",
      "vault-club-teams",
    ]));
  });

  it("invokes permanent deletion with the exact team boundary", async () => {
    mocks.isClubAdmin = true;
    mocks.deletedAt = "2026-07-01T00:00:00Z";
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Permanently Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm permanent team deletion" }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("permanent-delete-entity", {
      body: { entityType: "team", entityId: "team-1" },
    }));
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Team permanently deleted",
      description: "All data has been removed.",
    });
  });

  it("keys team, role, entitlement and administration reads by team, club and user context", () => {
    renderPage();
    const latest = (prefix: string) => [...mocks.queries].reverse().find(q => q.queryKey?.[0] === prefix);
    expect(latest("team").queryKey).toEqual(["team", "team-1"]);
    expect(latest("team-subscription").queryKey).toEqual(["team-subscription", "team-1"]);
    expect(latest("team-roles").queryKey).toEqual(["team-roles", "team-1"]);
    expect(latest("team-children").queryKey).toEqual(["team-children", "team-1"]);
    expect(latest("user-team-roles").queryKey).toEqual(["user-team-roles", "team-1", "user-1"]);
    expect(latest("club-subscription").queryKey).toEqual(["club-subscription", "club-1"]);
    expect(latest("is-club-admin").queryKey).toEqual(["is-club-admin", "user-1", "club-1"]);
  });

  it("propagates primary team, member-role and child-roster failures", async () => {
    renderPage();
    const latest = (prefix: string) => [...mocks.queries].reverse().find(q => q.queryKey?.[0] === prefix);

    const teamFailure = { message: "team unavailable", code: "42501" };
    mocks.results["teams:select"] = [{ data: null, error: teamFailure }];
    await expect(latest("team").queryFn()).rejects.toEqual(teamFailure);

    const rolesFailure = { message: "roles unavailable", code: "42501" };
    mocks.results["user_roles:select"] = [{ data: null, error: rolesFailure }];
    await expect(latest("team-roles").queryFn()).rejects.toMatchObject({
      name: "FriendlyQueryError",
      message: expect.stringContaining("team member list"),
      technicalMessage: "roles unavailable",
      cause: rolesFailure,
    });

    const childrenFailure = { message: "children unavailable", code: "42501" };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: childrenFailure });
    await expect(latest("team-children").queryFn()).rejects.toEqual(childrenFailure);
  });

  it("does not convert denied team or club subscription reads into a confirmed free entitlement", async () => {
    renderPage();
    const latest = (prefix: string) => [...mocks.queries].reverse().find(q => q.queryKey?.[0] === prefix);

    const teamFailure = { message: "team subscription denied", code: "42501" };
    mocks.results["team_subscriptions:select"] = [{ data: null, error: teamFailure }];
    await expect(latest("team-subscription").queryFn()).rejects.toEqual(teamFailure);

    const clubFailure = { message: "club subscription denied", code: "42501" };
    mocks.results["club_subscriptions:select"] = [{ data: null, error: clubFailure }];
    await expect(latest("club-subscription").queryFn()).rejects.toMatchObject({
      name: "FriendlyQueryError",
      message: expect.stringContaining("club's subscription details"),
      technicalMessage: "club subscription denied",
      cause: clubFailure,
    });
  });

  it("does not convert a denied club-admin check into a confirmed role revocation", async () => {
    renderPage();
    const latest = (prefix: string) => [...mocks.queries].reverse().find(q => q.queryKey?.[0] === prefix);
    const failure = { message: "admin check denied", code: "42501" };
    mocks.results["user_roles:select"] = [{ data: null, error: failure }];
    await expect(latest("is-club-admin").queryFn()).rejects.toMatchObject({
      name: "FriendlyQueryError",
      message: expect.stringContaining("club admin permissions"),
      technicalMessage: "admin check denied",
      cause: failure,
    });
  });
});
