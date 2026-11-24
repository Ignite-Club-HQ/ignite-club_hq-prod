import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
const mocks = vi.hoisted(() => ({ mounted: false, from: vi.fn(), session: vi.fn(), invoke: vi.fn() }));
vi.mock("@/live/authBackendMode", () => ({
  isSignedInWithEmail: () => false, isIcpProviderMounted: () => mocks.mounted,
  hasInternetIdentitySessionStored: () => false, readAuthChoice: () => null, resolveAuthBackend: () => "supabase",
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: mocks.from, auth: { getSession: mocks.session }, functions: { invoke: mocks.invoke },
} }));
vi.mock("@/lib/profileCache", () => ({ selectCachedProfileById: vi.fn() }));
vi.mock("@/lib/refreshSessionOnce", () => ({ refreshSessionOnce: vi.fn() }));
vi.mock("@/lib/rolesCache", () => ({ cacheRoles: vi.fn() }));
vi.mock("@/lib/clubTeamCache", () => ({ cacheClubs: vi.fn(), cacheTeams: vi.fn(), getCachedClubs: vi.fn(), getCachedTeams: vi.fn() }));
vi.mock("@/lib/icpClubTeamLookup", () => ({ icpGetTeam: async () => ({ club_id: "club-1" }) }));
vi.mock("@/lib/clubScopeLookup", () => ({ lookupRouteClubId: async () => "club-1" }));
import { prefetchUserData } from "./prefetchData";
import { resolveNotificationClubId } from "./notificationClubSwitch";
beforeEach(() => { vi.clearAllMocks(); mocks.mounted = false; });
describe("chat background work during mounted secure-session restoration", () => {
  it("does not start email prefetch under a mounted ICP provider", async () => {
    mocks.mounted = true;
    const queries = new QueryClient();
    await prefetchUserData(queries, "paul");
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
    queries.clear();
  });
  it("retires pending email session prefetch without falling through to database reads", async () => {
    mocks.session.mockImplementation(async () => {
      mocks.mounted = true;
      return { data: { session: null } };
    });
    const queries = new QueryClient();
    await prefetchUserData(queries, "paul");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
    queries.clear();
  });
  it.each(["/messages/team-1", "/groups/group-1"])("resolves the deferred %s notification on ICP", async url => {
    mocks.mounted = true;
    expect(await resolveNotificationClubId({}, url)).toBe("club-1");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});