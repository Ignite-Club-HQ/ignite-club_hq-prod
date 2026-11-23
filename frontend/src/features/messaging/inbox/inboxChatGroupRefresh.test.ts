import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  identity: { getPrincipal: () => ({ toText: () => "paul" }) },
  roles: vi.fn(), clubs: vi.fn(), list: vi.fn(), upkeep: vi.fn(), latest: vi.fn(), remember: vi.fn(),
}));
vi.mock("@/lab/fixtureDataLayer", () => ({}));
vi.mock("@/lib/messagesPageCache", () => ({ cacheMessagesPageData: vi.fn(), getCachedMessagesPageData: vi.fn() }));
vi.mock("@/lib/profileCache", () => ({}));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => "icp" }));
vi.mock("@/live/internetIdentityAuth", () => ({ getCurrentInternetIdentity: async () => mocks.identity }));
vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: () => ({ host: "https://icp-api.io", canisterIds: {} }) }));
vi.mock("@/live/features/identityAccessClient", () => ({ listLiveProfilesByIds: vi.fn() }));
vi.mock("@/live/features/membership", () => ({ getLiveMyRoleGrants: mocks.roles, listLiveMembershipTeams: vi.fn() }));
vi.mock("@/live/features/messaging", () => ({ listLiveGroupsByClub: mocks.list, listLiveLatestMessagesPage: mocks.latest }));
vi.mock("@/live/crossGroupClubs", () => ({ readClubsInOwnGroups: mocks.clubs, settleAll: vi.fn() }));
vi.mock("@/live/contentRouting", () => ({ readContentInScope: async (ctx: unknown, _feature: unknown, _scope: unknown, read: (ctx: unknown) => unknown) => read(ctx) }));
vi.mock("@/live/membershipRouting", () => ({ readMembershipInScope: vi.fn() }));
vi.mock("./inboxPreviewHydration", () => ({}));
vi.mock("@/live/defaultClubChats", () => ({ ensureLiveDefaultClubChats: mocks.upkeep }));
vi.mock("@/live/groupDispatch", () => ({ clubDispatch: { remember: mocks.remember } }));

import { fetchChatGroupsWithMessages, fetchTeamsWithMessages } from "./inboxPreviewSources";
import { settleAll } from "@/live/crossGroupClubs";
import { readMembershipInScope } from "@/live/membershipRouting";
const client = { from: vi.fn(), rpc: vi.fn() };
const chat = { conversationId: "chat-1", name: "U10 friends", isMember: true, teamId: null, kind: "group" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.roles.mockResolvedValue([{ role: "club_admin", club: ["riverdogs"] }]);
  mocks.clubs.mockResolvedValue({ values: [{ id: "riverdogs", name: "Riverdogs" }] });
  mocks.list.mockResolvedValue([chat]);
  mocks.upkeep.mockResolvedValue([]);
  mocks.latest.mockResolvedValue({ messages: [] });
});

describe("ICP inbox directory refresh", () => {
  it("excludes the canonical club conversation from group links without hiding real same-name groups", async () => {
    mocks.list.mockResolvedValue([
      { ...chat, conversationId: "riverdogs", clubId: "riverdogs", name: "Club chat" },
      { ...chat, conversationId: "private-chat", clubId: "riverdogs", name: "Club chat" },
      chat,
    ]);
    const result = await fetchChatGroupsWithMessages(client, "paul");
    expect(result.groups.map(g => g.id)).toEqual(["private-chat", "chat-1"]);
    expect(mocks.latest.mock.calls.map(call => call[1])).toEqual(["private-chat", "chat-1"]);
    expect(mocks.remember).toHaveBeenCalledWith("conversation", [["private-chat", "riverdogs"], ["chat-1", "riverdogs"]]);
  });

  it("retains the last successful chats when a refresh fails and replaces them on a successful retry", async () => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const options = { queryKey: ["my-chat-groups-with-messages", "paul"], queryFn: () => fetchChatGroupsWithMessages(client, "paul"), staleTime: 0 };
    try {
      const first = await queries.fetchQuery(options);
      expect(first.groups.map(g => g.id)).toEqual(["chat-1"]);
      mocks.list.mockRejectedValueOnce(new Error("profile revision changed"));
      await expect(queries.fetchQuery(options)).rejects.toThrow("profile revision changed");
      expect(queries.getQueryData(options.queryKey)).toBe(first);
      expect(queries.getQueryState(options.queryKey)?.status).toBe("error");
      mocks.list.mockResolvedValue([{ ...chat, conversationId: "chat-2" }]);
      expect((await queries.fetchQuery(options)).groups.map(g => g.id)).toEqual(["chat-2"]);
    } finally { queries.clear(); }
  });

  it("does not fail working chat reads when optional default-chat upkeep fails", async () => {
    mocks.upkeep.mockRejectedValueOnce(new Error("upkeep unavailable"));
    const result = await fetchChatGroupsWithMessages(client, "paul");
    expect(result.groups.map(g => g.id)).toEqual(["chat-1"]);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("rejects failed member reads too, without falling back to Supabase", async () => {
    mocks.roles.mockResolvedValue([{ role: "player", club: ["riverdogs"] }]);
    mocks.list.mockRejectedValueOnce(new Error("access forbidden"));
    await expect(fetchChatGroupsWithMessages(client, "paul")).rejects.toThrow("access forbidden");
    expect(client.from).not.toHaveBeenCalled();
    expect(mocks.upkeep).not.toHaveBeenCalled();
  });

  it("honours a successful empty directory instead of restoring deleted groups", async () => {
    mocks.list.mockResolvedValue([]);
    expect((await fetchChatGroupsWithMessages(client, "paul")).groups).toEqual([]);
  });
});
describe("ICP inbox team chats", () => {
  const teams = [
    { id: "u10", name: "U10", club_id: "riverdogs", deleted_at_ms: [], logo_url: [] },
    { id: "u12", name: "U12", club_id: "riverdogs", deleted_at_ms: [], logo_url: [] },
  ];
  beforeEach(() => {
    vi.mocked(settleAll).mockImplementation(async (ps: any[]) => ({ values: await Promise.all(ps) }) as any);
    vi.mocked(readMembershipInScope).mockResolvedValue(teams as any);
  });
  it("lists every team chat for a club admin without team grants", async () => {
    const result = await fetchTeamsWithMessages(client as any, "paul", false);
    expect(result.teams.map(t => t.id)).toEqual(["u10", "u12"]);
  });
  it("lists only assigned teams for an ordinary member", async () => {
    mocks.roles.mockResolvedValue([{ role: "player", club: ["riverdogs"], team: ["u12"] }]);
    const result = await fetchTeamsWithMessages(client as any, "paul", false);
    expect(result.teams.map(t => t.id)).toEqual(["u12"]);
  });
});
