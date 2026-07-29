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
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: any) => {
      const key = options.queryKey?.[0];
      if (key === "team") return { data: { id: "team-1", name: "Synthetic Team", club_id: "club-1", team_type: "senior", is_pro: false, deleted_at: mocks.deletedAt, clubs: { id: "club-1", name: "Synthetic Club", sport: "soccer", class_mode_enabled: false } }, isLoading: false, isFetching: false, fetchStatus: "idle" };
      if (key === "user-team-roles") return { data: mocks.teamRoles, isLoading: false, isFetching: false };
      if (key === "is-club-admin") return { data: mocks.isClubAdmin, isLoading: false, isFetching: false };
      if (key === "is-app-admin") return { data: mocks.isAppAdmin, isLoading: false, isFetching: false };
      if (key === "team-roles" || key === "team-children" || key === "pending-team-invites") return { data: [], isLoading: false, isFetching: false, refetch: vi.fn() };
      if (key === "club-subscription" || key === "team-subscription") return { data: null, isLoading: false, isFetching: false };
      return { data: undefined, isLoading: false, isFetching: false, fetchStatus: "idle", refetch: vi.fn() };
    },
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));
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

import TeamDetailPage from "./TeamDetailPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/teams/team-1"]}>
      <Routes><Route path="/teams/:id" element={<TeamDetailPage />} /></Routes>
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
});
