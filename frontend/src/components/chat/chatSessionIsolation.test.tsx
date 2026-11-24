import { render, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  icp: false, queries: [] as any[], mutations: [] as any[], from: vi.fn(), rpc: vi.fn(),
  metadata: vi.fn(), create: vi.fn(), policy: vi.fn(),
  ctx: { identity: { getPrincipal: () => ({ toText: () => "aaaaa-aa" }) } },
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQuery: (options: any) => { mocks.queries.push(options); return { data: undefined }; },
  useMutation: (options: any) => { mocks.mutations.push(options); return { mutate: vi.fn() }; },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "aaaaa-aa" }, profile: null }) }));
vi.mock("@/hooks/useClubTheme", () => ({ useClubTheme: () => ({ activeClubFilter: "club-1" }) }));
vi.mock("@/hooks/useUserPresence", () => ({ useOnlineSet: () => new Set() }));
vi.mock("@/hooks/useIcpConversationPresence", () => ({ useIcpConversationPresence: () => new Set() }));
vi.mock("@/hooks/useKeyboardOpen", () => ({ useKeyboardOpen: () => false }));
vi.mock("@/hooks/useClubFreeUsage", () => ({ useClubFreeUsage: () => ({ usage: null }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => mocks.icp }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => mocks.icp ? "icp" : "supabase" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: async (_feature: string, providers: any) => providers.icp(mocks.ctx) }));
vi.mock("@/live/features/messaging", () => ({
  getLiveGroupMetadata: mocks.metadata, createLiveGroupWithRoles: mocks.create, setLiveGroupJoinPolicy: mocks.policy,
  getOrCreateLiveDm: async () => ({ id: "dm-icp" }),
}));
vi.mock("@/live/features/membership", () => ({}));
vi.mock("@/live/features/identityAccessClient", () => ({}));
vi.mock("@/live/messagingCandidates", () => ({ fetchLiveMessagingCandidates: async () => [] }));
vi.mock("@/lib/icpClubTeamLookup", () => ({ icpGetTeam: async () => ({ club_id: "club-1" }), icpCtx: async () => mocks.ctx }));
vi.mock("@/lib/clubScopeLookup", () => ({ lookupRouteClubId: async () => "club-1" }));
vi.mock("@/components/AddRoleToMemberDialog", () => ({ default: () => null }));
vi.mock("@/components/chat/ParticipantProfileSheet", () => ({ ParticipantProfileSheet: () => null }));
vi.mock("@/components/ui/responsive-dialog", () => ({
  ResponsiveDialog: () => null, ResponsiveDialogContent: () => null,
  ResponsiveDialogHeader: () => null, ResponsiveDialogTitle: () => null,
  ResponsiveDialogDescription: () => null, ResponsiveDialogFooter: () => null,
}));

import { ChatParticipantsList } from "./ChatParticipantsList";
import { StartDMDialog } from "./StartDMDialog";
import { CreatePollDialog } from "./CreatePollDialog";

function query(key: string) {
  const options = mocks.queries.find((q) => q.queryKey[0] === key);
  if (!options) throw new Error(`No query ${key}`);
  return options.queryFn({ signal: new AbortController().signal });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.queries = []; mocks.mutations = []; mocks.icp = false;
  mocks.from.mockImplementation(() => { throw new Error("Legacy storage was used"); });
  mocks.rpc.mockImplementation(() => { throw new Error("Legacy action was used"); });
  mocks.metadata.mockResolvedValue({ members: [{ toText: () => "peer" }] });
  mocks.create.mockResolvedValue({ conversation_id: "new-chat" });
  mocks.policy.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("queued chat dialog queries after Internet Identity restoration", () => {
  it("reads participants through ICP even when its render chose email", async () => {
    render(<ChatParticipantsList chatType="group" chatId="chat-1" chatName="Friends" />);
    mocks.icp = true;
    const members = await query("chat-members");
    expect(members.map((m: any) => m.id)).toEqual(["peer"]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([
    ["chat-group-meta", null], ["club-bot-user", null],
    ["chat-members-notif-prefs", {}], ["chat-members-push-reachable", {}],
    ["chat-members-mute-prefs", {}], ["chat-members-role-entries", {}],
    ["chat-members-online-heartbeat", []],
  ])("retires the email-only %s query before touching legacy storage", async (key, expected) => {
    render(<ChatParticipantsList chatType="group" chatId="chat-1" chatName="Friends" />);
    mocks.icp = true;
    expect(await query(key)).toEqual(expected);
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("routes a delayed people picker through ICP", async () => {
    render(<StartDMDialog open={false} />);
    mocks.icp = true;
    expect(await query("has-pro-for-dm")).toBe(true);
    expect(await query("can-send-dms")).toEqual({ canSend: true, reason: null });
    expect(await query("dmable-users-with-filters")).toEqual({ users: [], clubs: [], teams: [] });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("starts a delayed direct-message action on ICP", async () => {
    render(<StartDMDialog open={false} />);
    mocks.icp = true;
    expect(await mocks.mutations[0].mutationFn("aaaaa-aa")).toBe("dm-icp");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("creates a manual ICP group with only the explicitly selected members and creator", async () => {
    render(<StartDMDialog open={false} mode="custom-group" />);
    mocks.icp = true;
    expect(await mocks.mutations[1].mutationFn({ users: [{ id: "ryjl3-tyaaa-aaaaa-aaaba-cai" }], customName: "Friends", category: null })).toBe("new-chat");
    expect(mocks.create).toHaveBeenCalledWith(mocks.ctx, "club-1", null, "Friends", "group", expect.any(Array));
    expect(mocks.create.mock.calls[0][5].map(([p, role]: any) => [p.toText(), role])).toEqual([
      ["ryjl3-tyaaa-aaaaa-aaaba-cai", "member"], ["aaaaa-aa", "owner"],
    ]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("resolves a delayed poll's club on ICP", async () => {
    render(<CreatePollDialog open={false} onOpenChange={vi.fn()} chatType="group" chatId="chat-1" onCreated={vi.fn()} />);
    mocks.icp = true;
    expect(await query("poll-club-resolve")).toBe("club-1");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("keeps an acknowledged group when only its category save fails, without creating a second group", async () => {
    render(<StartDMDialog open={false} mode="custom-group" />);
    mocks.icp = true;
    mocks.policy.mockRejectedValueOnce(new Error("category unavailable"));
    expect(await mocks.mutations[1].mutationFn({ users: [], customName: "Friends", category: "Operations" })).toBe("new-chat");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.policy).toHaveBeenCalledWith(mocks.ctx, "new-chat", "invite_only", "Operations");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});