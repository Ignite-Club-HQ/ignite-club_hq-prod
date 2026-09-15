import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  token: "join-token",
  auth: { user: null as null | { id: string }, loading: false },
  tableResults: new Map<string, { data: any; error: any }>(),
  rpcResults: new Map<string, { data: any; error: any }>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("react-router-dom", async () => {
  const React = await import("react");
  return {
    useSearchParams: () => [new URLSearchParams(mocks.token ? { token: mocks.token } : {})],
    useNavigate: () => mocks.navigate,
    Link: ({ to, children, ...props }: any) => React.createElement("a", { href: to, ...props }, children),
  };
});

import CompetitionJoinPage from "./CompetitionJoinPage";

function tableQuery(table: string) {
  const query: any = {};
  for (const method of ["select", "eq", "in", "not"]) query[method] = vi.fn(() => query);
  Object.defineProperty(query, "then", {
    value: (resolve: any) =>
      Promise.resolve(mocks.tableResults.get(table) ?? { data: [], error: null }).then(resolve),
  });
  return query;
}

const competition = {
  id: "competition-1",
  name: "Winter League",
  organizer_club_id: "club-organizer",
  organizer_club_name: "County Association",
  sport: "Football",
  season: "2026",
  status: "active",
};

function validToken(overrides?: {
  divisions?: any[];
  entered?: any[];
  competitionResult?: { data: any; error: any };
}) {
  mocks.rpcResults.set(
    "get_competition_by_join_token",
    overrides?.competitionResult ?? { data: [competition], error: null },
  );
  mocks.rpcResults.set("list_divisions_by_join_token", {
    data: overrides?.divisions ?? [],
    error: null,
  });
  mocks.rpcResults.set("get_competition_join_token_status", { data: "active", error: null });
  mocks.rpcResults.set("list_entered_team_ids_by_join_token", {
    data: overrides?.entered ?? [],
    error: null,
  });
}

function directAdminTeam(id = "team-1", name = "Riverside Firsts") {
  return {
    team_id: id,
    teams: { id, name, club_id: "club-1", clubs: { name: "Riverside FC" } },
  };
}

describe("competition join-token workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.token = "join-token";
    mocks.auth.user = null;
    mocks.auth.loading = false;
    mocks.tableResults.clear();
    mocks.rpcResults.clear();
    mocks.from.mockImplementation(tableQuery);
    mocks.rpc.mockImplementation((name: string) =>
      Promise.resolve(mocks.rpcResults.get(name) ?? { data: null, error: null }),
    );
  });

  it("rejects a missing token without making any backend request", async () => {
    mocks.token = "";
    render(<CompetitionJoinPage />);

    expect(await screen.findByText(/missing its token/i)).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", /organiser has disabled this join link/i],
    ["archived", /competition has been archived/i],
    ["unknown", /join link isn't recognised/i],
  ])("shows a safe explanation for a %s token", async (status, message) => {
    mocks.rpcResults.set("get_competition_by_join_token", { data: [], error: null });
    mocks.rpcResults.set("list_divisions_by_join_token", { data: [], error: null });
    mocks.rpcResults.set("get_competition_join_token_status", { data: status, error: null });
    render(<CompetitionJoinPage />);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("preserves the join URL and sends a signed-out visitor to authentication", async () => {
    validToken();
    render(<CompetitionJoinPage />);
    fireEvent.click(await screen.findByRole("button", { name: /sign in to join/i }));

    expect(sessionStorage.getItem("redirectAfterAuth")).toBe(
      "/competitions/join?token=join-token",
    );
    const destination = mocks.navigate.mock.calls[0]?.[0];
    expect(destination).toBeTypeOf("string");
    const authUrl = new URL(destination, "https://ignite.test");
    expect(authUrl.pathname).toBe("/auth");
    expect(authUrl.searchParams.get("mode")).toBe("signup");
    expect(authUrl.searchParams.get("next")).toBe(
      "/competitions/join?token=join-token",
    );
    expect(authUrl.searchParams.get("redirect")).toBe(
      "/competitions/join?token=join-token",
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith("join_competition_with_token", expect.anything());
  });

  it("loads only teams administered by the signed-in user", async () => {
    mocks.auth.user = { id: "user-1" };
    validToken();
    mocks.tableResults.set("user_roles", { data: [directAdminTeam()], error: null });
    render(<CompetitionJoinPage />);

    expect(await screen.findByRole("button", { name: /join competition/i })).toBeEnabled();
    const userRoleQueries = mocks.from.mock.results
      .filter(result => result.value)
      .map(result => result.value)
      .filter(query => query.eq?.mock?.calls?.length);
    expect(userRoleQueries).toHaveLength(2);
    for (const query of userRoleQueries) {
      expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
    }
  });

  it("auto-selects the sole eligible team and joins with a null division", async () => {
    mocks.auth.user = { id: "user-1" };
    validToken();
    mocks.tableResults.set("user_roles", { data: [directAdminTeam()], error: null });
    mocks.rpcResults.set("join_competition_with_token", {
      data: [{ competition_id: "competition-1" }],
      error: null,
    });
    render(<CompetitionJoinPage />);

    fireEvent.click(await screen.findByRole("button", { name: /join competition/i }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("join_competition_with_token", {
      p_token: "join-token",
      p_team_id: "team-1",
      p_division_id: null,
    }));
    expect(await screen.findByText(/you're in/i)).toBeInTheDocument();
  });

  it("does not offer another mutation when every administered team is already entered", async () => {
    mocks.auth.user = { id: "user-1" };
    validToken({ entered: [{ team_id: "team-1", status: "accepted" }] });
    mocks.tableResults.set("user_roles", { data: [directAdminTeam()], error: null });
    render(<CompetitionJoinPage />);

    expect(await screen.findByText(/all of your teams are already entered/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view competition/i }));
    expect(mocks.navigate).toHaveBeenCalledWith("/competitions/competition-1");
    expect(mocks.rpc).not.toHaveBeenCalledWith("join_competition_with_token", expect.anything());
  });

  it("does not treat a rejected or removed entry as currently entered", async () => {
    mocks.auth.user = { id: "user-1" };
    validToken({ entered: [
      { team_id: "team-1", status: "rejected" },
      { team_id: "team-1", status: "removed" },
    ] });
    mocks.tableResults.set("user_roles", { data: [directAdminTeam()], error: null });
    render(<CompetitionJoinPage />);

    expect(await screen.findByRole("button", { name: /join competition/i })).toBeEnabled();
  });

  it.each([
    ["not_team_admin", "You don't have admin rights for that team."],
    ["invalid_token", "This join link is no longer valid."],
    ["team_not_found", "That team could not be found."],
    ["auth_required", "Please sign in first."],
  ])("maps the %s mutation failure to an actionable message", async (code, friendly) => {
    mocks.auth.user = { id: "user-1" };
    validToken();
    mocks.tableResults.set("user_roles", { data: [directAdminTeam()], error: null });
    mocks.rpcResults.set("join_competition_with_token", {
      data: null,
      error: { message: code },
    });
    render(<CompetitionJoinPage />);

    fireEvent.click(await screen.findByRole("button", { name: /join competition/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not join",
      description: friendly,
      variant: "destructive",
    }));
    expect(screen.queryByText(/you're in/i)).not.toBeInTheDocument();
  });
});
