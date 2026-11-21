import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- mocks ----
const getLiveTeamInviteMock = vi.fn();
const acceptLiveTeamInviteMock = vi.fn();
const getLiveTeamInviteLinkByTokenMock = vi.fn();
const acceptLiveTeamInviteLinkMock = vi.fn();
const getLiveTeamMock = vi.fn();
const getLiveClubProfileMock = vi.fn();
vi.mock("@/live/features/club", () => ({
  getLiveTeamInviteLinkByToken: (...args: unknown[]) => getLiveTeamInviteLinkByTokenMock(...args),
  acceptLiveTeamInviteLink: (...args: unknown[]) => acceptLiveTeamInviteLinkMock(...args),
  getLiveTeam: (...args: unknown[]) => getLiveTeamMock(...args),
  getLiveClubProfile: (...args: unknown[]) => getLiveClubProfileMock(...args),
}));
vi.mock("@/live/features/membership", () => ({
  getLiveTeamInvite: (...args: unknown[]) => getLiveTeamInviteMock(...args),
  acceptLiveTeamInvite: (...args: unknown[]) => acceptLiveTeamInviteMock(...args),
}));

const playerPreviewMock = vi.fn();
const claimPlayerMock = vi.fn();
const getLiveJoinLinkByTokenMock = vi.fn();
const getLiveMiniLeagueMock = vi.fn();
const claimLiveAdminJoinLinkMock = vi.fn();
vi.mock("@/live/features/miniLeagues", () => ({
  getLivePlayerInvitePreview: (...args: unknown[]) => playerPreviewMock(...args),
  claimLiveInvite: (...args: unknown[]) => claimPlayerMock(...args),
  getLiveJoinLinkByToken: (...args: unknown[]) => getLiveJoinLinkByTokenMock(...args),
  getLiveMiniLeague: (...args: unknown[]) => getLiveMiniLeagueMock(...args),
  claimLiveAdminJoinLink: (...args: unknown[]) => claimLiveAdminJoinLinkMock(...args),
}));

let membershipRoutedToIcp = false;
let currentIcpPrincipal = "principal-abc";
vi.mock("@/live/invitePreview", () => ({
  readInvitePreview: async (_token: string, providers: any, options?: { forceIcp?: boolean }) =>
    membershipRoutedToIcp || options?.forceIcp
      ? providers.icp({ identity: { getPrincipal: () => ({ toText: () => currentIcpPrincipal }) }, target: {} })
      : providers.supabase(),
}));
vi.mock("@/live/loadBackendRouting", () => ({
  isFeatureRoutedToIcp: (feature: string) => feature === "membership" && membershipRoutedToIcp,
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: async (_feature: string, providers: any) =>
    membershipRoutedToIcp
      ? providers.icp({ identity: { getPrincipal: () => ({ toText: () => currentIcpPrincipal }) }, target: {} })
      : providers.supabase(),
}));

vi.mock("@/lab/localRuntimeMode", () => ({
  resolveLocalAuthMode: () => false,
}));

const setAuthMethodChoiceMock = vi.fn();
vi.mock("@/live/authBackendMode", () => ({
  resolveAuthBackend: () => (membershipRoutedToIcp ? "icp" : "supabase"),
  setAuthMethodChoice: (...args: unknown[]) => setAuthMethodChoiceMock(...args),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "principal-abc", email: "parent@example.com" }, loading: false }),
  useOptionalAuth: () => ({ user: { id: "principal-abc" }, sessionRestoration: "authenticated" }),
}));

vi.mock("@/hooks/useClubTheme", () => ({
  useClubTheme: () => ({ setActiveClubTheme: vi.fn() }),
}));

// Join errors surface via toast (no Toaster is mounted in this test), so
// capture the toast calls to assert on user-facing error messages.
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const sendGamificationNotificationMock = vi.fn();
vi.mock("@/lib/gamificationNotify", () => ({
  sendGamificationNotification: (...args: unknown[]) => sendGamificationNotificationMock(...args),
}));

const rpcMock = vi.fn();
const fromMock = vi.fn(() => ({
  select: () => ({
    eq: () => ({ single: () => Promise.resolve({ data: null }), maybeSingle: () => Promise.resolve({ data: null }) }),
  }),
  update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
  insert: () => Promise.resolve({ data: null, error: null }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => fromMock(),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("@/lib/profileCache", () => ({
  selectCachedProfileById: async () => ({ data: { display_name: "Parent Person" } }),
}));
vi.mock("@/live/identityProfile", () => ({
  fetchIcpIdentityProfile: async () => ({ displayName: "Parent Person", avatarRef: null }),
}));

import JoinTeamPage from "./JoinTeamPage";

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/join/:token" element={<JoinTeamPage />} />
          <Route path="/join/p/:token" element={<JoinTeamPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const regularInviteRow = {
  id: "invite-1",
  team_id: "team-1",
  role: "coach",
  token: "tok-1",
  uses_count: 0,
  max_uses: 5,
  expires_at: null,
  created_at: null,
  created_by: null,
  metadata: null,
  team_name: "Wolves",
  team_logo_url: null,
  club_id: "club-1",
  club_name: "Ignite Club",
};

beforeEach(() => {
  sessionStorage.clear();
  membershipRoutedToIcp = false;
  currentIcpPrincipal = "principal-abc";
  rpcMock.mockReset();
  getLiveTeamInviteMock.mockReset();
  acceptLiveTeamInviteMock.mockReset();
  getLiveTeamInviteLinkByTokenMock.mockReset().mockResolvedValue(null);
  acceptLiveTeamInviteLinkMock.mockReset().mockResolvedValue(undefined);
  getLiveTeamMock.mockReset().mockResolvedValue([]);
  getLiveClubProfileMock.mockReset().mockResolvedValue([]);
  toastMock.mockClear();
  sendGamificationNotificationMock.mockClear();
  setAuthMethodChoiceMock.mockClear();
  playerPreviewMock.mockReset().mockResolvedValue(null);
  claimPlayerMock.mockReset();
  getLiveJoinLinkByTokenMock.mockReset();
  getLiveMiniLeagueMock.mockReset();
  claimLiveAdminJoinLinkMock.mockReset();
  rpcMock.mockImplementation((name: string) => {
    if (name === "get_team_invite_by_token") {
      return Promise.resolve({ data: [regularInviteRow], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

describe("JoinTeamPage team-invite acceptance routing", () => {
  it("Supabase branch: resolves the invite via the RPC (unchanged) when membership is not ICP-routed", async () => {
    membershipRoutedToIcp = false;
    renderAt("/join/tok-1");

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("get_team_invite_by_token", { _token: "tok-1" }));
    expect(getLiveTeamInviteMock).not.toHaveBeenCalled();
    expect(acceptLiveTeamInviteMock).not.toHaveBeenCalled();
  });

  it("ICP branch: resolves via getLiveTeamInvite and accepts via acceptLiveTeamInvite", async () => {
    membershipRoutedToIcp = true;
    getLiveTeamInviteMock.mockResolvedValue(regularInviteRow);
    acceptLiveTeamInviteMock.mockResolvedValue({});

    renderAt("/join/tok-1");

    await waitFor(() => expect(getLiveTeamInviteMock).toHaveBeenCalledWith(expect.anything(), "tok-1"));
    // get_team_invite_by_token RPC must not be used on the ICP branch.
    expect(rpcMock).not.toHaveBeenCalledWith("get_team_invite_by_token", expect.anything());

    // The button is disabled until the invite role auto-selects into
    // selectedRoles — wait for it to become enabled before clicking.
    const joinButton = await screen.findByRole("button", { name: /join/i });
    await waitFor(() => expect(joinButton).toBeEnabled());
    fireEvent.click(joinButton);

    await waitFor(() => expect(acceptLiveTeamInviteMock).toHaveBeenCalledWith(expect.anything(), "invite-1"));
    expect(getLiveTeamInviteMock).toHaveBeenCalledWith(expect.anything(), "invite-1");
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Successfully joined as Coach!" }),
      ),
    );
    expect(sendGamificationNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "principal-abc",
        kind: "membership",
        message: expect.stringContaining("Coach"),
      }),
    );
  });

  it("ICP shareable links are accepted by token, not by a legacy invite ID", async () => {
    membershipRoutedToIcp = true;
    getLiveTeamInviteLinkByTokenMock.mockResolvedValue({
      id: "link-1", team_id: "team-1", club_id: "club-1", role: "coach",
      revoked: false, created_at_ms: 1000n,
    });
    renderAt("/join/share-token");
    const joinButton = await screen.findByRole("button", { name: /join/i });
    await waitFor(() => expect(joinButton).toBeEnabled());
    fireEvent.click(joinButton);
    await waitFor(() => expect(acceptLiveTeamInviteLinkMock).toHaveBeenCalledWith(expect.anything(), "share-token"));
    expect(acceptLiveTeamInviteMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses shareable invite redemption when the signer and displayed account differ", async () => {
    membershipRoutedToIcp = true;
    currentIcpPrincipal = "different-principal";
    getLiveTeamInviteLinkByTokenMock.mockResolvedValue({
      id: "link-1", team_id: "team-1", club_id: "club-1", role: "coach",
      revoked: false, created_at_ms: 1000n,
    });
    renderAt("/join/share-token");
    const joinButton = await screen.findByRole("button", { name: /join/i });
    await waitFor(() => expect(joinButton).toBeEnabled());
    fireEvent.click(joinButton);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't complete your join",
        description: expect.stringContaining("Internet Identity changed during joining"),
      }),
    ));
    expect(acceptLiveTeamInviteLinkMock).not.toHaveBeenCalled();
  });

  it("ICP tok-hex parent invites are previewed even when signed-out routing defaults to email", async () => {
    membershipRoutedToIcp = false;
    const token = "tok-0123456789abcdef0123456789abcdef";
    getLiveTeamInviteLinkByTokenMock.mockResolvedValue({
      id: "tlink-" + token, token, team_id: "team-1", club_id: "club-1",
      role: "parent", revoked: false, created_at_ms: 1000n,
    });

    renderAt("/join/" + token);
    expect(await screen.findByText("Internet Identity Required")).toBeInTheDocument();
    expect(getLiveTeamInviteLinkByTokenMock).toHaveBeenCalledWith(expect.anything(), token);
    expect(rpcMock).not.toHaveBeenCalledWith("get_team_invite_by_token", expect.anything());
    expect(acceptLiveTeamInviteLinkMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /continue with internet identity/i }));
    expect(setAuthMethodChoiceMock).toHaveBeenCalledTimes(1);
    expect(setAuthMethodChoiceMock).toHaveBeenCalledWith("icp");
    expect(acceptLiveTeamInviteLinkMock).not.toHaveBeenCalled();
  });

  it("renders the actual team and club names for a verified ICP shareable parent invite", async () => {
    membershipRoutedToIcp = true;
    const token = "tok-0123456789abcdef0123456789abcdef";
    getLiveTeamInviteLinkByTokenMock.mockResolvedValue({
      id: "tlink-" + token, token, team_id: "team-1", club_id: "club-1",
      role: "parent", revoked: false, created_at_ms: 1000n,
    });
    getLiveTeamMock.mockResolvedValue([{ id: "team-1", club_id: "club-1", name: "ChatGPT Plugin Test U10", logo_url: [] }]);
    getLiveClubProfileMock.mockResolvedValue([{ id: "club-1", name: "Group 2 test", logo_url: [] }]);

    renderAt("/join/" + token);

    expect(await screen.findByRole("heading", { name: "Join ChatGPT Plugin Test U10" })).toBeInTheDocument();
    expect(screen.getByText("Group 2 test")).toBeInTheDocument();
    expect(getLiveTeamMock).toHaveBeenCalledWith(expect.anything(), "team-1");
    expect(getLiveClubProfileMock).toHaveBeenCalledWith(expect.anything(), "club-1");
    expect(acceptLiveTeamInviteLinkMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not display unrelated team names when an invite's team/club ownership mismatches", async () => {
    membershipRoutedToIcp = true;
    const token = "tok-0123456789abcdef0123456789abcdef";
    getLiveTeamInviteLinkByTokenMock.mockResolvedValue({
      id: "tlink-" + token, token, team_id: "team-1", club_id: "club-1",
      role: "parent", revoked: false, created_at_ms: 1000n,
    });
    getLiveTeamMock.mockResolvedValue([{ id: "team-1", club_id: "other-club", name: "Someone Else's Team", logo_url: [] }]);
    getLiveClubProfileMock.mockResolvedValue([{ id: "club-1", name: "Group 2 test", logo_url: [] }]);

    renderAt("/join/" + token);

    // The page intentionally retries failed invite reads twice (1s delay)
    // before showing an error. Keep the security assertion, but give that
    // existing retry policy time to finish.
    expect(await screen.findByText("Couldn't Verify Invitation", {}, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.queryByText("Someone Else's Team")).not.toBeInTheDocument();
    expect(acceptLiveTeamInviteLinkMock).not.toHaveBeenCalled();
  });

  it("keeps a valid ICP invite usable when public label reads are temporarily unavailable", async () => {
    membershipRoutedToIcp = true;
    const token = "tok-0123456789abcdef0123456789abcdef";
    getLiveTeamInviteLinkByTokenMock.mockResolvedValue({
      id: "tlink-" + token, token, team_id: "team-1", club_id: "club-1",
      role: "parent", revoked: false, created_at_ms: 1000n,
    });
    getLiveTeamMock.mockRejectedValue(new Error("temporary public read outage"));
    getLiveClubProfileMock.mockResolvedValue([]);

    renderAt("/join/" + token);

    expect(await screen.findByRole("heading", { name: "Join this team" })).toBeInTheDocument();
    expect(acceptLiveTeamInviteLinkMock).not.toHaveBeenCalled();
  });

  it("mini-league join under ICP shows an unavailable message instead of joining", async () => {
    membershipRoutedToIcp = true;
    const miniLeagueRow = {
      ...regularInviteRow,
      metadata: { mini_league_id: "league-1" },
    };
    getLiveTeamInviteMock.mockResolvedValue(miniLeagueRow);

    renderAt("/join/tok-1");
    await waitFor(() => expect(getLiveTeamInviteMock).toHaveBeenCalled());

    const joinButton = await screen.findByRole("button", { name: /join/i });
    await waitFor(() => expect(joinButton).toBeEnabled());
    fireEvent.click(joinButton);

    // The join mutation throws and the error surfaces via toast.
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringMatching(/mini-league isn't available for internet identity accounts/i),
        }),
      ),
    );
    expect(acceptLiveTeamInviteMock).not.toHaveBeenCalled();
  });

  it("ICP branch: resolves an admin join link via getLiveJoinLinkByToken and claims it via claimLiveAdminJoinLink", async () => {
    membershipRoutedToIcp = true;
    getLiveJoinLinkByTokenMock.mockResolvedValue({
      token: "adm-1",
      mini_league_id: "league-1",
      role: "admin",
      revoked: false,
    });
    getLiveMiniLeagueMock.mockResolvedValue({ id: "league-1", name: "Summer League", club_id: "club-1" });
    claimLiveAdminJoinLinkMock.mockResolvedValue({});

    renderAt("/join/p/adm-1");

    // The pending-invite RPC must not be used on the ICP branch.
    await waitFor(() => expect(getLiveJoinLinkByTokenMock).toHaveBeenCalledWith(expect.anything(), "adm-1"));
    expect(rpcMock).not.toHaveBeenCalledWith("get_pending_invite_by_token", expect.anything());

    const joinButton = await screen.findByRole("button", { name: /join/i });
    await waitFor(() => expect(joinButton).toBeEnabled());
    fireEvent.click(joinButton);

    await waitFor(() => expect(claimLiveAdminJoinLinkMock).toHaveBeenCalledWith(expect.anything(), "adm-1"));
    // Neither the team-invite nor the mini-league block paths may run.
    expect(acceptLiveTeamInviteMock).not.toHaveBeenCalled();
  });
});
