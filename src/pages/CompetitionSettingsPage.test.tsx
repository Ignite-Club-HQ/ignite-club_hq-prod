import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
  refetch: vi.fn(),
  invalidateQueries: vi.fn(),
  auth: { user: { id: "admin-1" } as null | { id: string } },
  access: { hasPro: true, isLoading: false },
  state: {
    competition: null as any,
    competitionLoading: false,
    isAdmin: true,
    adminLoading: false,
    divisions: [] as any[],
    coordinators: [] as any[],
    candidates: [] as any[],
  },
  updateResult: { error: null as any },
  lastUpdateQuery: null as any,
  competitionRoleQuery: null as any,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/hooks/useClubProAccess", () => ({ useClubProAccess: () => mocks.access }));
vi.mock("@/components/subscription/ProFeatureLock", () => ({
  ProFeatureLock: ({ title, description, clubId }: any) => (
    <div data-testid="pro-lock" data-club-id={clubId}>{title} — {description}</div>
  ),
}));
vi.mock("react-router-dom", async () => {
  const React = await import("react");
  return {
    useParams: () => ({ id: "competition-1" }),
    useNavigate: () => mocks.navigate,
    Link: ({ to, children, ...props }: any) => React.createElement("a", { href: to, ...props }, children),
  };
});
vi.mock("@tanstack/react-query", async importOriginal => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
  ...actual,
  useQuery: ({ queryKey, enabled = true }: any) => {
    const key = queryKey[0];
    if (key === "competition") {
      return {
        data: mocks.state.competition,
        isLoading: mocks.state.competitionLoading,
        refetch: mocks.refetch,
      };
    }
    if (key === "competition-isadmin") {
      return { data: mocks.state.isAdmin, isLoading: mocks.state.adminLoading };
    }
    if (key === "competition-divisions") return { data: mocks.state.divisions, isLoading: false };
    if (key === "competition-roles") return { data: mocks.state.coordinators, isLoading: false };
    if (key === "competition-admin-search") {
      return { data: enabled ? mocks.state.candidates : [], isFetching: false };
    }
    return { data: undefined, isLoading: false };
  },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: ({ mutationFn, onSuccess, onError }: any) => ({
    mutate: (variables: any) => { void mutationFn(variables).then(onSuccess).catch(onError); },
    mutateAsync: async (variables: any) => {
      try {
        const result = await mutationFn(variables);
        onSuccess?.(result);
        return result;
      } catch (error) {
        onError?.(error);
        throw error;
      }
    },
    isPending: false,
  }),
  };
});

import CompetitionSettingsPage from "./CompetitionSettingsPage";

const competition = {
  id: "competition-1",
  name: "Winter League",
  description: "Saturday competition",
  status: "draft",
  visibility: "private",
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  organizer_club_id: "club-1",
  source: "native",
  clubs: { kind: "full" },
};

function updateQuery() {
  const query: any = {};
  query.update = vi.fn(() => query);
  query.insert = vi.fn(() => query);
  query.delete = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  Object.defineProperty(query, "then", {
    value: (resolve: any) => Promise.resolve(mocks.updateResult).then(resolve),
  });
  mocks.lastUpdateQuery = query;
  return query;
}

describe("competition settings authorization and saving", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.user = { id: "admin-1" };
    mocks.access.hasPro = true;
    mocks.access.isLoading = false;
    mocks.state.competition = { ...competition };
    mocks.state.competitionLoading = false;
    mocks.state.isAdmin = true;
    mocks.state.adminLoading = false;
    mocks.state.divisions = [];
    mocks.state.coordinators = [];
    mocks.state.candidates = [];
    mocks.updateResult.error = null;
    mocks.lastUpdateQuery = null;
    mocks.competitionRoleQuery = null;
    mocks.from.mockImplementation((table: string) => {
      const query = updateQuery();
      if (table === "competition_roles") mocks.competitionRoleQuery = query;
      return query;
    });
  });

  it("does not expose settings while competition or permission checks are loading", () => {
    mocks.state.adminLoading = true;
    const { container } = render(<CompetitionSettingsPage />);

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("shows a not-found state without exposing mutation controls", () => {
    mocks.state.competition = null;
    render(<CompetitionSettingsPage />);

    expect(screen.getByText("Competition not found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("denies a non-admin before rendering any editable competition fields", () => {
    mocks.state.isAdmin = false;
    render(<CompetitionSettingsPage />);

    expect(screen.getByText(/don't have permission to manage this competition/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("blocks an administrator when the organiser club lacks Pro entitlement", () => {
    mocks.access.hasPro = false;
    render(<CompetitionSettingsPage />);

    expect(screen.getByTestId("pro-lock")).toHaveAttribute("data-club-id", "club-1");
    expect(screen.getByText(/managing competitions is a pro feature/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("keeps PlayHQ competitions read-only for a non-association club", () => {
    mocks.state.competition = {
      ...competition,
      source: "playhq",
      clubs: { kind: "full" },
    };
    render(<CompetitionSettingsPage />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.queryByText("Publishing")).not.toBeInTheDocument();
    expect(screen.queryByText("Ladder scoring")).not.toBeInTheDocument();
    expect(screen.queryByText("Ladder visibility")).not.toBeInTheDocument();
  });

  it("does not issue an update until an editable value changes", () => {
    render(<CompetitionSettingsPage />);

    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("trims values and scopes a successful update to the current competition", async () => {
    render(<CompetitionSettingsPage />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Summer League  " } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "  Updated rules  " } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith("competitions"));
    expect(mocks.lastUpdateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      name: "Summer League",
      description: "Updated rules",
      status: "draft",
      visibility: "private",
      points_win: 3,
      points_draw: 1,
      points_loss: 0,
    }));
    expect(mocks.lastUpdateQuery.eq).toHaveBeenCalledWith("id", "competition-1");
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
  });

  it("reports an update failure without claiming success or refetching", async () => {
    mocks.updateResult.error = { message: "update denied" };
    render(<CompetitionSettingsPage />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Summer League" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not save",
      description: "update denied",
      variant: "destructive",
    }));
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(screen.queryByText("Changes saved")).not.toBeInTheDocument();
  });

  it("scopes a ladder-visibility update and refreshes both affected views", async () => {
    mocks.state.divisions = [{ id: "division-1", name: "Premier", hide_ladder: false }];
    render(<CompetitionSettingsPage />);

    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith("competition_divisions"));
    expect(mocks.lastUpdateQuery.update).toHaveBeenCalledWith({ hide_ladder: true });
    expect(mocks.lastUpdateQuery.eq).toHaveBeenCalledWith("id", "division-1");
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["competition-divisions", "competition-1"],
    }));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["competition-ladder", "competition-1"],
    });
  });

  it("reports a ladder update failure without refreshing cached ladders", async () => {
    mocks.state.divisions = [{ id: "division-1", name: "Premier", hide_ladder: false }];
    mocks.updateResult.error = { message: "ladder update denied" };
    render(<CompetitionSettingsPage />);

    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not update",
      description: "ladder update denied",
      variant: "destructive",
    }));
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it("never offers a control to remove the competition owner", () => {
    mocks.state.coordinators = [{
      id: "role-owner", user_id: "owner-1", role: "owner",
      profile: { display_name: "Competition Owner", avatar_url: null },
    }];
    render(<CompetitionSettingsPage />);

    expect(screen.getByText("Competition Owner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove competition owner/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave" })).not.toBeInTheDocument();
  });

  it("adds only the selected eligible coordinator with an admin role", async () => {
    mocks.state.candidates = [{
      id: "candidate-1",
      display_name: "Casey Coach",
      avatar_url: null,
      source: "club admin",
      masked_email: "c***@example.com",
    }];
    render(<CompetitionSettingsPage />);
    fireEvent.change(screen.getByLabelText("Search members to add as competition admin"), { target: { value: "Casey" } });
    await screen.findByText("Casey Coach");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith("competition_roles"));
    expect(mocks.competitionRoleQuery.insert).toHaveBeenCalledWith({
      competition_id: "competition-1",
      user_id: "candidate-1",
      role: "admin",
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Competition admin added" })));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["competition-roles", "competition-1"],
    });
  });

  it("scopes removal to both competition and coordinator identity", async () => {
    mocks.state.coordinators = [{
      id: "role-coordinator", user_id: "coordinator-1", role: "admin",
      profile: { display_name: "Casey Coach", avatar_url: null },
    }];
    render(<CompetitionSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Casey Coach as admin" }));

    await waitFor(() => expect(mocks.lastUpdateQuery.delete).toHaveBeenCalledOnce());
    expect(mocks.lastUpdateQuery.eq).toHaveBeenCalledWith("id", "role-coordinator");
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Admin removed" }));
  });

  it("does not offer removal of the current admin", () => {
    mocks.state.coordinators = [{
      id: "role-current", user_id: "admin-1", role: "admin",
      profile: { display_name: "Current Admin", avatar_url: null },
    }];
    render(<CompetitionSettingsPage />);
    expect(screen.getByText("Current Admin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove current admin/i })).not.toBeInTheDocument();
  });

  it("keeps current-admin access separate from removing other admins", () => {
    mocks.state.coordinators = [{
      id: "role-current", user_id: "admin-1", role: "admin",
      profile: { display_name: "Current Admin", avatar_url: null },
    }, {
      id: "role-other", user_id: "other-1", role: "admin",
      profile: { display_name: "Other Admin", avatar_url: null },
    }];
    render(<CompetitionSettingsPage />);
    expect(screen.queryByRole("button", { name: /remove current admin/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Other Admin as admin" })).toBeInTheDocument();
  });
});
