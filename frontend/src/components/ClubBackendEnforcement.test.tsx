import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "principal:test-member", app_metadata: { provider: "icp" } },
  identity: {},
  grants: vi.fn(), homeCountries: vi.fn(), signOut: vi.fn(),
  emailRead: vi.fn(), toast: vi.fn(), authSignOut: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useOptionalAuth: () => ({ user: state.user }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/components/AppSplash", () => ({ AppSplash: () => <div>Loading</div> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: state.emailRead, auth: { signOut: state.authSignOut } },
}));
vi.mock("@/live/internetIdentityAuth", () => ({
  getCurrentInternetIdentityConfirmed: async () => state.identity,
  signOutInternetIdentity: state.signOut,
}));
vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: () => ({ canisterIds: { club_domain: "test" } }) }));
vi.mock("@/live/features/membership", () => ({ getLiveMyRoleGrants: state.grants }));
vi.mock("@/live/features/club", () => ({ getLiveClubHomeCountries: state.homeCountries }));

import { ClubBackendEnforcement } from "./ClubBackendEnforcement";
import { applyBackendRoutingConfig, CLUB_HOME_BACKEND_HINT_KEY } from "@/live/backendRouting";
import { getUserClubIds } from "@/live/userClubs";

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
  window.history.replaceState(null, "", "/auth");
  applyBackendRoutingConfig({ defaultBackend: "supabase", countryRules: { AU: "supabase", DE: "icp" }, targets: [], countryTargets: {}, clubBackendOverrides: {} });
  state.grants.mockResolvedValue([{ club: ["giddy-goat"], role: "parent" }]);
  state.homeCountries.mockResolvedValue({ "giddy-goat": "AU" });
});

describe("confirmed Internet Identity membership", () => {
  it.each(["", "?auth=icp"])("retains the account and canister clubs despite email country defaults (%s)", async (search) => {
    window.history.replaceState(null, "", `/auth${search}`);
    render(<ClubBackendEnforcement><div>Signed-in club</div></ClubBackendEnforcement>);
    await waitFor(() => expect(screen.getByText("Signed-in club")).toBeTruthy());
    expect(getUserClubIds()).toEqual(["giddy-goat"]);
    expect(state.signOut).not.toHaveBeenCalled();
    expect(state.emailRead).not.toHaveBeenCalled();
    expect(state.homeCountries).not.toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
    expect(localStorage.getItem(CLUB_HOME_BACKEND_HINT_KEY)).toBe("icp");
    expect(window.location.pathname).toBe("/auth");
  });

  it("preserves the existing hint and session when membership retrieval fails", async () => {
    localStorage.setItem(CLUB_HOME_BACKEND_HINT_KEY, "icp");
    state.grants.mockRejectedValueOnce(new Error("Unavailable"));
    render(<ClubBackendEnforcement><div>Signed-in club</div></ClubBackendEnforcement>);
    await waitFor(() => expect(screen.getByText("Signed-in club")).toBeTruthy());
    expect(state.signOut).not.toHaveBeenCalled();
    expect(state.emailRead).not.toHaveBeenCalled();
    expect(localStorage.getItem(CLUB_HOME_BACKEND_HINT_KEY)).toBe("icp");
  });

  it("keeps a new Internet Identity account on-chain before it joins a club", async () => {
    state.grants.mockResolvedValueOnce([]);
    render(<ClubBackendEnforcement><div>Signed-in club</div></ClubBackendEnforcement>);
    await waitFor(() => expect(screen.getByText("Signed-in club")).toBeTruthy());
    expect(getUserClubIds()).toEqual([]);
    expect(state.signOut).not.toHaveBeenCalled();
    expect(state.emailRead).not.toHaveBeenCalled();
  });
});

// --- email sign-in allowlist -------------------------------------------------
// Real DEV club ids: Bridgewater keeps email sign-in, the other one does not.
const BRIDGE = "966bdaec-ebf1-46da-b2b3-cc53bf05c422";
const OTHER = "0f2a1b6c-7d3e-4a5b-8c9d-0e1f2a3b4c5d";

/** A supabase query builder that resolves to `result` however it is chained. */
function query(result: unknown) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    then: (resolve: (value: unknown) => void) => resolve(result),
  };
  return builder;
}

function emailUser(clubId: string | null) {
  state.user = { id: "email:member", app_metadata: { provider: "email" } };
  state.emailRead.mockImplementation((table: string) => query(
    table === "user_roles"
      ? { data: clubId ? [{ club_id: clubId, team_id: null, role: "player" }] : [], error: null }
      : { data: [], error: null },
  ));
}

const ALLOWLIST_CONFIG = {
  defaultBackend: "icp",
  countryRules: {},
  targets: [],
  countryTargets: {},
  clubBackendOverrides: {},
  emailAuthClubs: [{ id: BRIDGE, name: "Bridgewater Soccer Club" }],
};

describe("email sign-in allowlist", () => {
  beforeEach(() => {
    applyBackendRoutingConfig(ALLOWLIST_CONFIG);
    localStorage.setItem("ignite.authChoice", "supabase");
  });

  it("signs out an email account whose club is outside the allowlist", async () => {
    emailUser(OTHER);
    render(<ClubBackendEnforcement><div>Signed-in club</div></ClubBackendEnforcement>);
    await waitFor(() => expect(state.authSignOut).toHaveBeenCalled());
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Switching sign-in method",
    }));
    // The device pick is dropped so the sign-in picker offers both paths again.
    expect(localStorage.getItem("ignite.authChoice")).toBeNull();
  });

  it("keeps an email account that belongs to an allowlisted club", async () => {
    emailUser(BRIDGE);
    render(<ClubBackendEnforcement><div>Signed-in club</div></ClubBackendEnforcement>);
    await waitFor(() => expect(screen.getByText("Signed-in club")).toBeTruthy());
    expect(state.authSignOut).not.toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
    expect(localStorage.getItem("ignite.authChoice")).toBe("supabase");
  });

  it("does not sign out an email account whose membership lookup failed", async () => {
    state.user = { id: "email:member", app_metadata: { provider: "email" } };
    state.emailRead.mockImplementation(() => { throw new Error("database down"); });
    render(<ClubBackendEnforcement><div>Signed-in club</div></ClubBackendEnforcement>);
    await waitFor(() => expect(screen.getByText("Signed-in club")).toBeTruthy());
    expect(state.authSignOut).not.toHaveBeenCalled();
  });
});