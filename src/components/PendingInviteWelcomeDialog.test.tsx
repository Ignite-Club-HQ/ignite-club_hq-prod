/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase's fluent test double carries heterogeneous rows */
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type DbCall = { table: string; op: string; payload?: any; filters: Array<[string, string, any]> };

const mocks = vi.hoisted(() => ({
  user: { id: "user-accepting", user_metadata: { display_name: "Alex" } } as any,
  invites: [] as any[],
  calls: [] as DbCall[],
  responder: vi.fn(),
  invalidateQueries: vi.fn(),
  seedClubFilter: vi.fn(),
  setActiveClubTheme: vi.fn(),
  queryOptions: null as any,
}));

function queryBuilder(table: string) {
  const call: DbCall = { table, op: "select", filters: [] };
  const result = () => mocks.responder(call) ?? { data: null, error: null };
  const builder: any = {
    select: () => builder,
    insert: (payload: any) => { call.op = "insert"; call.payload = payload; return builder; },
    update: (payload: any) => { call.op = "update"; call.payload = payload; return builder; },
    delete: () => { call.op = "delete"; return builder; },
    eq: (column: string, value: any) => { call.filters.push(["eq", column, value]); return builder; },
    is: (column: string, value: any) => { call.filters.push(["is", column, value]); return builder; },
    limit: async () => result(),
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
  };
  mocks.calls.push(call);
  return builder;
}

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: any) => {
      mocks.queryOptions = options;
      return { data: mocks.invites };
    },
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/useClubTheme", () => ({
  useClubTheme: () => ({ setActiveClubTheme: mocks.setActiveClubTheme }),
}));
vi.mock("@/lib/seedClubFilterFromInvite", () => ({
  seedClubFilterFromInvite: mocks.seedClubFilter,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => queryBuilder(table),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));

import { PendingInviteWelcomeDialog } from "./PendingInviteWelcomeDialog";

const invite = (overrides: Record<string, any> = {}) => ({
  id: "invite-a",
  role: "coach",
  invite_token: "token-a",
  team_id: "team-a",
  club_id: "club-a",
  invited_label: "Alex",
  metadata: null,
  teams: { name: "Rovers U12", club_id: "club-a", clubs: { name: "Rovers" } },
  clubs: null,
  ...overrides,
});

const callsFor = (table: string, op?: string) =>
  mocks.calls.filter((call) => call.table === table && (!op || call.op === op));

describe("PendingInviteWelcomeDialog membership transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    mocks.invites = [];
    mocks.user = { id: "user-accepting", user_metadata: { display_name: "Alex" } };
    mocks.responder.mockImplementation(() => ({ data: null, error: null }));
    mocks.seedClubFilter.mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("fetches only pending invites belonging to the signed-in user", async () => {
    render(<PendingInviteWelcomeDialog />);
    await mocks.queryOptions.queryFn();

    const query = callsFor("pending_invites", "select")[0];
    expect(query.filters).toEqual(expect.arrayContaining([
      ["eq", "invited_user_id", "user-accepting"],
      ["eq", "status", "pending"],
    ]));
  });

  it("does not fetch or process invitations while signed out", async () => {
    mocks.user = null;
    mocks.invites = [invite()];
    render(<PendingInviteWelcomeDialog />);
    expect(mocks.queryOptions.enabled).toBe(false);
    expect(await mocks.queryOptions.queryFn()).toEqual([]);
    expect(mocks.calls).toHaveLength(0);
  });

  it("creates the exact scoped membership before accepting an invite", async () => {
    mocks.invites = [invite()];
    render(<PendingInviteWelcomeDialog />);

    await waitFor(() => expect(callsFor("pending_invites", "update")).toHaveLength(1));
    expect(callsFor("user_roles", "insert")[0].payload).toEqual({
      user_id: "user-accepting", role: "coach", team_id: "team-a", club_id: "club-a",
    });
    expect(callsFor("pending_invites", "update")[0]).toEqual(expect.objectContaining({
      payload: expect.objectContaining({ status: "accepted", invited_user_id: "user-accepting" }),
      filters: [["eq", "id", "invite-a"]],
    }));
  });

  it("treats an already-existing exact role as idempotently fulfilled", async () => {
    mocks.invites = [invite()];
    mocks.responder.mockImplementation((call: DbCall) =>
      call.table === "user_roles" && call.op === "select"
        ? { data: { id: "existing-role" }, error: null }
        : { data: null, error: null },
    );
    render(<PendingInviteWelcomeDialog />);

    await waitFor(() => expect(callsFor("pending_invites", "update")).toHaveLength(1));
    expect(callsFor("user_roles", "insert")).toHaveLength(0);
  });

  it("does not mark an invite accepted when membership creation fails", async () => {
    mocks.invites = [invite()];
    mocks.responder.mockImplementation((call: DbCall) =>
      call.table === "user_roles" && call.op === "insert"
        ? { data: null, error: { message: "role denied" } }
        : { data: null, error: null },
    );
    render(<PendingInviteWelcomeDialog />);

    await waitFor(() => expect(callsFor("user_roles", "insert")).toHaveLength(1));
    expect(callsFor("pending_invites", "update")).toHaveLength(0);
    expect(mocks.seedClubFilter).toHaveBeenCalledWith(
      "user-accepting", "club-a", mocks.setActiveClubTheme,
    );
  });

  it("isolates a failed invite so a later valid invite can still be accepted", async () => {
    mocks.invites = [invite({ id: "bad-invite", team_id: "team-b" }), invite({ id: "good-invite" })];
    let roleInsert = 0;
    mocks.responder.mockImplementation((call: DbCall) => {
      if (call.table === "user_roles" && call.op === "insert" && roleInsert++ === 0) {
        return { data: null, error: { message: "first denied" } };
      }
      return { data: null, error: null };
    });
    render(<PendingInviteWelcomeDialog />);

    await waitFor(() => expect(callsFor("pending_invites", "update")).toHaveLength(1));
    expect(callsFor("pending_invites", "update")[0].filters).toEqual([["eq", "id", "good-invite"]]);
  });

  it("does not accept a parent invite when its required guardian link fails", async () => {
    mocks.invites = [invite({
      role: "parent",
      metadata: { guardian_child_id: "child-a", guardian_all_team_ids: ["team-a"] },
    })];
    mocks.responder.mockImplementation((call: DbCall) => {
      if (call.table === "child_guardians" && call.op === "insert") {
        return { data: null, error: { message: "guardian link denied" } };
      }
      if (call.table === "teams" && call.op === "select") {
        return { data: { club_id: "club-a" }, error: null };
      }
      return { data: null, error: null };
    });
    render(<PendingInviteWelcomeDialog />);

    await waitFor(() => expect(callsFor("child_guardians", "insert")).toHaveLength(1));
    expect(callsFor("pending_invites", "update")).toHaveLength(0);
  });

  it("refreshes membership state and seeds the invited club after successful processing", async () => {
    mocks.invites = [invite()];
    render(<PendingInviteWelcomeDialog />);

    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["user-roles"] }));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pending-invites-for-user"] });
    expect(mocks.seedClubFilter).toHaveBeenCalledWith(
      "user-accepting", "club-a", mocks.setActiveClubTheme,
    );
  });
});
