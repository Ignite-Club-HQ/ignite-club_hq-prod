import { beforeEach, describe, expect, it, vi } from "vitest";
const mode = vi.hoisted(() => ({ mounted: true, email: false }));
vi.mock("@/live/authBackendMode", () => ({
  isSignedInWithEmail: () => mode.email,
  isIcpProviderMounted: () => mode.mounted,
  hasInternetIdentitySessionStored: () => false,
  readAuthChoice: () => null,
  resolveAuthBackend: () => "supabase",
}));
const client = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/lib/profileCache", () => ({ selectCachedProfileById: vi.fn(), selectCachedProfilesByIds: vi.fn() }));
import * as inbox from "./inboxRepositories";
import * as navigation from "@/features/notifications/notificationNavigationRepository";
import { filterClubScopedNotifications } from "@/lib/filterClubScopedNotifications";
import { isIcpSession } from "@/lib/icpClubTeamLookup";
const readers = [...Object.entries(inbox), ...Object.entries(navigation)].filter(([, fn]) => typeof fn === "function");
beforeEach(() => { mode.mounted = true; mode.email = false; vi.clearAllMocks(); });
describe("mounted Internet Identity with no stored delegation", () => {
  it.each(readers)("blocks the legacy %s reader before any client access", async (_name, fn) => {
    await expect((fn as (...args: any[]) => unknown)({}, client, client)).rejects.toThrow("Your sign-in changed");
    expect(client.from).not.toHaveBeenCalled(); expect(client.rpc).not.toHaveBeenCalled();
  });
  it("identifies the mounted secure session even while the country resolver says email", () => {
    expect(isIcpSession()).toBe(true);
  });
  it("keeps only proven club or global notification scope without email lookups", async () => {
    const rows = [
      { id: "own", type: "group_message", related_id: "message", club_id: "club-1" },
      { id: "foreign", type: "group_message", related_id: "message", club_id: "club-2" },
      { id: "unknown", type: "group_message", related_id: "message", club_id: null },
      { id: "global", type: "system_update", related_id: null, club_id: null },
    ];
    expect((await filterClubScopedNotifications(rows, "paul", "club-1")).map(r => r.id)).toEqual(["own", "global"]);
    expect(client.from).not.toHaveBeenCalled();
  });
  it("preserves email transport instead of applying the secure-mode refusal", async () => {
    mode.email = true;
    const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: null, error: null }) };
    client.from.mockReturnValue(builder);
    expect(await inbox.fetchInboxAppAdminStatus("paul")).toBe(false);
    expect(client.from).toHaveBeenCalledWith("user_roles");
  });
});