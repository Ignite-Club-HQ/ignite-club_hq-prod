import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onIcp: false,
  queries: [] as Array<{ queryKey: unknown[]; queryFn: () => Promise<unknown> }>,
  from: vi.fn(), metadata: vi.fn(), grants: vi.fn(), scopedRead: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: typeof mocks.queries[number]) => {
  mocks.queries.push(options);
  return { data: undefined };
} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "paul" }, unreadMessagesCount: 3 }) }));
vi.mock("@/hooks/useClubTheme", () => ({ useClubTheme: () => ({ activeClubFilter: "club-1", activeClubTeamIds: [] }) }));
vi.mock("@/hooks/useUnreadMessageCounts", () => ({ useUnreadMessageCounts: () => ({ data: {
  groups: { "chat-1": 1 }, dms: { "dm-1": 2 }, clubs: {}, teams: {}, broadcast: 0,
} }) }));
vi.mock("@/lib/pushTapSuppression", () => ({ useSuppressedChatScopes: () => [] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => mocks.onIcp }));
vi.mock("@/lib/icpClubTeamLookup", () => ({ icpCtx: async () => ({ identity: { getPrincipal: () => ({ toText: () => "paul-principal" }) } }) }));
vi.mock("@/live/features/messaging", () => ({ getLiveGroupMetadata: mocks.metadata }));
vi.mock("@/live/features/membership", () => ({ listLiveRoleGrants: mocks.grants }));
vi.mock("@/live/contentRouting", () => ({ readContentInScope: mocks.scopedRead }));

import { useNavMessagesBadgeCount } from "./useNavMessagesBadgeCount";

function query(prefix: string) {
  const options = mocks.queries.find((q) => q.queryKey[0] === prefix);
  if (!options) throw new Error(`Missing query ${prefix}`);
  return options.queryFn();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queries = [];
  mocks.onIcp = false;
  mocks.from.mockImplementation(() => { throw new Error("Blocked legacy storage read"); });
  mocks.metadata.mockResolvedValue({ clubId: "club-1", teamId: null, members: [{ toText: () => "peer" }] });
  mocks.grants.mockResolvedValue([{ account_id: "peer" }]);
  mocks.scopedRead.mockImplementation(async (ctx, _feature, _scope, read) => read(ctx));
});

describe("Home navigation queued reads during Internet Identity restoration", () => {
  it("reads group ownership from ICP when secure mode starts after rendering", async () => {
    useNavMessagesBadgeCount();
    mocks.onIcp = true;
    await expect(query("chat-groups-club-map")).resolves.toEqual({ "chat-1": { club_id: "club-1", team_id: null } });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.scopedRead).toHaveBeenCalledWith(expect.anything(), "messaging", { conversationId: "chat-1" }, expect.any(Function));
  });

  it("does not run an already-enabled email broadcast query after secure sign-in", async () => {
    useNavMessagesBadgeCount();
    mocks.onIcp = true;
    await expect(query("bottomnav-club-broadcast-unread")).resolves.toBe(0);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("resolves queued direct-message peers through ICP rather than email storage", async () => {
    useNavMessagesBadgeCount();
    mocks.onIcp = true;
    await expect(query("bottomnav-club-scoped-dms")).resolves.toEqual(["dm-1"]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("preserves the email group ownership read when the user remains in email mode", async () => {
    mocks.from.mockReturnValue({ select: () => ({ in: async () => ({ data: [{ id: "chat-1", club_id: "club-1", team_id: null }] }) }) });
    useNavMessagesBadgeCount();
    await expect(query("chat-groups-club-map")).resolves.toEqual({ "chat-1": { club_id: "club-1", team_id: null } });
    expect(mocks.from).toHaveBeenCalledWith("chat_groups");
    expect(mocks.metadata).not.toHaveBeenCalled();
  });
});