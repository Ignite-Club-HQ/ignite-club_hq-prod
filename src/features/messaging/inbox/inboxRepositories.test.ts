import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchInboxAdminTeamIds,
  fetchInboxAppAdminStatus,
  fetchInboxClubScopeFilter,
  fetchInboxClubProStatus,
  fetchInboxCommitteeMemberStatus,
  fetchInboxCompetitionClubMap,
  fetchInboxEventTitleMap,
  fetchInboxHiddenDirectMessages,
  fetchInboxHiddenGroups,
  fetchInboxMutedChats,
  fetchInboxUserLeagueIds,
  fetchInboxUserRoles,
  fetchInboxVaultFileNameMap,
  fetchInboxVaultFolderNameMap,
} from "./inboxRepositories";

type IgniteSupabaseClient = SupabaseClient<Database>;

function queryClient(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn(),
    then: (
      resolve: (value: typeof result) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue(result);
  const from = vi.fn().mockReturnValue(builder);

  return {
    client: { from } as unknown as IgniteSupabaseClient,
    from,
    builder,
  };
}

function tableQueryClient(results: Record<string, { data: unknown; error: unknown }>) {
  const queries = Object.fromEntries(
    Object.entries(results).map(([table, result]) => [table, queryClient(result)]),
  );
  const from = vi.fn((table: string) => queries[table].builder);
  return {
    client: { from } as unknown as IgniteSupabaseClient,
    from,
    queries,
  };
}

describe("messaging inbox repositories", () => {
  it.each([
    {
      label: "event titles",
      fetcher: fetchInboxEventTitleMap,
      table: "events",
      selection: "id, title",
      rows: [
        { id: "EVENT-A", title: "Final" },
        { id: "event-b", title: "" },
      ],
      expected: { "event-a": "Final" },
    },
    {
      label: "vault folder names",
      fetcher: fetchInboxVaultFolderNameMap,
      table: "vault_folders",
      selection: "id, name",
      rows: [
        { id: "FOLDER-A", name: "Policies" },
        { id: "folder-b", name: "" },
      ],
      expected: { "folder-a": "Policies" },
    },
    {
      label: "vault file names",
      fetcher: fetchInboxVaultFileNameMap,
      table: "vault_files",
      selection: "id, name",
      rows: [
        { id: "FILE-A", name: "Roster.pdf" },
        { id: "file-b", name: "" },
      ],
      expected: { "file-a": "Roster.pdf" },
    },
  ])("maps $label with normalized identifiers and exact scoped reads", async ({
    fetcher,
    table,
    selection,
    rows,
    expected,
  }) => {
    const fake = queryClient({ data: rows, error: null });
    await expect(fetcher(["A", "B"], fake.client)).resolves.toEqual(expected);
    expect(fake.from).toHaveBeenCalledWith(table);
    expect(fake.builder.select).toHaveBeenCalledWith(selection);
    expect(fake.builder.in).toHaveBeenCalledWith("id", ["A", "B"]);
  });

  it.each([
    ["event titles", fetchInboxEventTitleMap],
    ["vault folder names", fetchInboxVaultFolderNameMap],
    ["vault file names", fetchInboxVaultFileNameMap],
  ])("keeps empty %s reads query-free and propagates failures", async (_label, fetcher) => {
    const empty = queryClient({ data: [], error: null });
    await expect(fetcher([], empty.client)).resolves.toEqual({});
    expect(empty.from).not.toHaveBeenCalled();

    const failure = new Error("metadata lookup failed");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetcher(["id-1"], failed.client)).rejects.toBe(failure);
  });

  it("builds the active-club scope from personal-group members and DM peers", async () => {
    const fake = tableQueryClient({
      group_members: {
        data: [
          { group_id: "group-1", user_id: "user-1" },
          { group_id: "group-1", user_id: "member-1" },
          { group_id: "group-2", user_id: "member-2" },
          { group_id: "group-2", user_id: "dm-peer" },
        ],
        error: null,
      },
      user_roles: {
        data: [
          { user_id: "member-1" },
          { user_id: "dm-peer" },
          { user_id: "dm-peer" },
        ],
        error: null,
      },
    });

    const result = await fetchInboxClubScopeFilter({
      userId: "user-1",
      clubId: "club-1",
      personalGroupIds: ["group-1", "group-2"],
      dmOtherUserIds: ["dm-peer"],
      client: fake.client,
    });

    expect(result.groupMembersMap).toEqual(new Map([
      ["group-1", ["user-1", "member-1"]],
      ["group-2", ["member-2", "dm-peer"]],
    ]));
    expect([...result.usersInClub]).toEqual(["member-1", "dm-peer"]);
    expect(fake.from.mock.calls.map(([table]) => table)).toEqual(["group_members", "user_roles"]);
    expect(fake.queries.group_members.builder.in).toHaveBeenCalledWith(
      "group_id", ["group-1", "group-2"],
    );
    expect(fake.queries.user_roles.builder.eq).toHaveBeenCalledWith("club_id", "club-1");
    expect(fake.queries.user_roles.builder.in).toHaveBeenCalledWith(
      "user_id", ["dm-peer", "member-1", "member-2"],
    );
  });

  it("supports DM-only and group-only club scopes", async () => {
    const dmOnly = tableQueryClient({
      user_roles: { data: [{ user_id: "dm-peer" }], error: null },
    });
    const dmResult = await fetchInboxClubScopeFilter({
      userId: "user-1", clubId: "club-1", personalGroupIds: [],
      dmOtherUserIds: ["dm-peer"], client: dmOnly.client,
    });
    expect(dmResult.groupMembersMap).toEqual(new Map());
    expect(dmResult.usersInClub).toEqual(new Set(["dm-peer"]));
    expect(dmOnly.from.mock.calls.map(([table]) => table)).toEqual(["user_roles"]);

    const groupOnly = tableQueryClient({
      group_members: { data: [{ group_id: "group-1", user_id: "member-1" }], error: null },
      user_roles: { data: [{ user_id: "member-1" }], error: null },
    });
    const groupResult = await fetchInboxClubScopeFilter({
      userId: "user-1", clubId: "club-1", personalGroupIds: ["group-1"],
      dmOtherUserIds: [], client: groupOnly.client,
    });
    expect(groupResult.groupMembersMap).toEqual(new Map([["group-1", ["member-1"]]]));
    expect(groupResult.usersInClub).toEqual(new Set(["member-1"]));
  });

  it("keeps an empty club scope query-free", async () => {
    const fake = tableQueryClient({});
    await expect(fetchInboxClubScopeFilter({
      userId: "user-1", clubId: "club-1", personalGroupIds: [],
      dmOtherUserIds: [], client: fake.client,
    })).resolves.toEqual({ groupMembersMap: new Map(), usersInClub: new Set() });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it.each([
    ["group-members", "group_members"],
    ["club-roles", "user_roles"],
  ])("propagates a %s scope-filter failure", async (_label, failingTable) => {
    const failure = new Error(`${failingTable} unavailable`);
    const fake = tableQueryClient({
      group_members: {
        data: [{ group_id: "group-1", user_id: "member-1" }],
        error: failingTable === "group_members" ? failure : null,
      },
      user_roles: {
        data: [{ user_id: "member-1" }],
        error: failingTable === "user_roles" ? failure : null,
      },
    });

    await expect(fetchInboxClubScopeFilter({
      userId: "user-1", clubId: "club-1", personalGroupIds: ["group-1"],
      dmOtherUserIds: [], client: fake.client,
    })).rejects.toBe(failure);
  });

  it("reads the exact group-management roles and returns only scoped team ids", async () => {
    const success = queryClient({
      data: [
        { team_id: "team-1", club_id: "club-1", role: "coach" },
        { team_id: null, club_id: "club-1", role: "committee_member" },
        { team_id: "team-2", club_id: "club-2", role: "team_admin" },
      ],
      error: null,
    });

    await expect(fetchInboxAdminTeamIds("user-1", success.client)).resolves.toEqual([
      "team-1", "team-2",
    ]);
    expect(success.from).toHaveBeenCalledWith("user_roles");
    expect(success.builder.select).toHaveBeenCalledWith("team_id, club_id, role");
    expect(success.builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(success.builder.in).toHaveBeenCalledWith(
      "role", ["team_admin", "coach", "committee_member"],
    );
  });

  it("does not replace admin-team capability with an empty list on failure", async () => {
    const failure = new Error("admin team roles unavailable");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetchInboxAdminTeamIds("user-1", failed.client)).rejects.toBe(failure);
  });

  it("reads committee capability for only the current user and propagates failure", async () => {
    const success = queryClient({ data: { id: "role-1" }, error: null });
    await expect(fetchInboxCommitteeMemberStatus("user-1", success.client)).resolves.toBe(true);
    expect(success.builder.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(success.builder.eq).toHaveBeenNthCalledWith(2, "role", "committee_member");
    expect(success.builder.maybeSingle).toHaveBeenCalledOnce();

    const failure = new Error("committee role unavailable");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetchInboxCommitteeMemberStatus("user-1", failed.client)).rejects.toBe(failure);
  });

  it("preserves all role scopes and does not publish empty roles on failure", async () => {
    const rows = [
      { role: "coach", club_id: "club-1", team_id: "team-1" },
      { role: "parent", club_id: "club-1", team_id: null },
    ];
    const success = queryClient({ data: rows, error: null });
    await expect(fetchInboxUserRoles("user-1", success.client)).resolves.toEqual(rows);
    expect(success.builder.select).toHaveBeenCalledWith("role, club_id, team_id");
    expect(success.builder.eq).toHaveBeenCalledWith("user_id", "user-1");

    const failure = new Error("all roles unavailable");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetchInboxUserRoles("user-1", failed.client)).rejects.toBe(failure);
  });

  it("unions primary and guardian children before reading mini-league assignments", async () => {
    const fake = tableQueryClient({
      children: { data: [{ id: "child-1" }, { id: "shared-child" }], error: null },
      child_guardians: {
        data: [{ child_id: "shared-child" }, { child_id: "child-2" }],
        error: null,
      },
      child_mini_league_assignments: {
        data: [
          { mini_league_id: "league-1" },
          { mini_league_id: "league-1" },
          { mini_league_id: "league-2" },
        ],
        error: null,
      },
    });

    const result = await fetchInboxUserLeagueIds("user-1", fake.client);
    expect([...result]).toEqual(["league-1", "league-2"]);
    expect(fake.from.mock.calls.map(([table]) => table)).toEqual([
      "children", "child_guardians", "child_mini_league_assignments",
    ]);
    expect(fake.queries.children.builder.eq).toHaveBeenCalledWith("parent_id", "user-1");
    expect(fake.queries.child_guardians.builder.eq).toHaveBeenCalledWith("guardian_id", "user-1");
    expect(fake.queries.child_mini_league_assignments.builder.in).toHaveBeenCalledWith(
      "child_id", ["child-1", "shared-child", "child-2"],
    );
  });

  it("supports guardian-only membership and avoids an assignment query with no children", async () => {
    const guardianOnly = tableQueryClient({
      children: { data: [], error: null },
      child_guardians: { data: [{ child_id: "child-2" }], error: null },
      child_mini_league_assignments: {
        data: [{ mini_league_id: "league-2" }], error: null,
      },
    });
    await expect(fetchInboxUserLeagueIds("user-1", guardianOnly.client)).resolves.toEqual(
      new Set(["league-2"]),
    );

    const noChildren = tableQueryClient({
      children: { data: [], error: null },
      child_guardians: { data: [], error: null },
    });
    await expect(fetchInboxUserLeagueIds("user-1", noChildren.client)).resolves.toEqual(
      new Set(),
    );
    expect(noChildren.from).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["primary-child", "children"],
    ["guardian-link", "child_guardians"],
    ["assignment", "child_mini_league_assignments"],
  ])("propagates a %s membership read failure", async (_label, failingTable) => {
    const failure = new Error(`${failingTable} unavailable`);
    const fake = tableQueryClient({
      children: {
        data: [{ id: "child-1" }],
        error: failingTable === "children" ? failure : null,
      },
      child_guardians: {
        data: [],
        error: failingTable === "child_guardians" ? failure : null,
      },
      child_mini_league_assignments: {
        data: [{ mini_league_id: "league-1" }],
        error: failingTable === "child_mini_league_assignments" ? failure : null,
      },
    });

    await expect(fetchInboxUserLeagueIds("user-1", fake.client)).rejects.toBe(failure);
  });

  it("reads only the current user's app-admin role and propagates failures", async () => {
    const success = queryClient({ data: { id: "role-1" }, error: null });
    await expect(fetchInboxAppAdminStatus("user-1", success.client)).resolves.toBe(true);
    expect(success.from).toHaveBeenCalledWith("user_roles");
    expect(success.builder.select).toHaveBeenCalledWith("id");
    expect(success.builder.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(success.builder.eq).toHaveBeenNthCalledWith(2, "role", "app_admin");
    expect(success.builder.maybeSingle).toHaveBeenCalledOnce();

    const failure = new Error("role lookup failed");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetchInboxAppAdminStatus("user-1", failed.client)).rejects.toBe(failure);
  });

  it("returns early for an empty club scope without issuing a query", async () => {
    const fake = queryClient({ data: [], error: null });
    await expect(fetchInboxClubProStatus([], { client: fake.client })).resolves.toEqual({});
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("maps current Pro flags and preserves false entries for missing or expired clubs", async () => {
    const fake = queryClient({
      data: [
        {
          club_id: "pro",
          is_pro: true,
          is_pro_football: false,
          admin_pro_override: false,
          admin_pro_football_override: false,
          expires_at: null,
        },
        {
          club_id: "football",
          is_pro: false,
          is_pro_football: true,
          admin_pro_override: false,
          admin_pro_football_override: false,
          expires_at: "2026-08-04T12:00:00.001Z",
        },
        {
          club_id: "expired",
          is_pro: true,
          is_pro_football: false,
          admin_pro_override: false,
          admin_pro_football_override: false,
          expires_at: "2026-08-04T12:00:00.000Z",
        },
      ],
      error: null,
    });

    await expect(fetchInboxClubProStatus(
      ["pro", "football", "expired", "missing"],
      { client: fake.client, now: Date.parse("2026-08-04T12:00:00.000Z") },
    )).resolves.toEqual({
      pro: true,
      football: true,
      expired: false,
      missing: false,
    });
    expect(fake.from).toHaveBeenCalledWith("club_subscriptions");
    expect(fake.builder.in).toHaveBeenCalledWith(
      "club_id",
      ["pro", "football", "expired", "missing"],
    );
  });

  it("does not convert a Pro lookup failure into an all-false entitlement map", async () => {
    const failure = new Error("subscription lookup failed");
    const fake = queryClient({ data: null, error: failure });
    await expect(fetchInboxClubProStatus(["club-1"], { client: fake.client })).rejects.toBe(failure);
  });

  it("deduplicates competition club membership while preserving competition scope", async () => {
    const fake = queryClient({
      data: [
        { competition_id: "comp-1", teams: { club_id: "club-1" } },
        { competition_id: "comp-1", teams: { club_id: "club-1" } },
        { competition_id: "comp-1", teams: { club_id: "club-2" } },
        { competition_id: "comp-2", teams: { club_id: "club-3" } },
        { competition_id: "comp-2", teams: null },
      ],
      error: null,
    });

    const result = await fetchInboxCompetitionClubMap(["comp-1", "comp-2"], fake.client);
    expect([...result["comp-1"]]).toEqual(["club-1", "club-2"]);
    expect([...result["comp-2"]]).toEqual(["club-3"]);
    expect(fake.from).toHaveBeenCalledWith("competition_entries");
    expect(fake.builder.select).toHaveBeenCalledWith("competition_id, teams:team_id(club_id)");
    expect(fake.builder.in).toHaveBeenCalledWith("competition_id", ["comp-1", "comp-2"]);
  });

  it("keeps an empty competition scope query-free and propagates backend failures", async () => {
    const empty = queryClient({ data: [], error: null });
    await expect(fetchInboxCompetitionClubMap([], empty.client)).resolves.toEqual({});
    expect(empty.from).not.toHaveBeenCalled();

    const failure = new Error("competition lookup failed");
    const failed = queryClient({ data: null, error: failure });
    await expect(fetchInboxCompetitionClubMap(["comp-1"], failed.client)).rejects.toBe(failure);
  });

  it("does not replace known mute preferences with an empty result when their read fails", async () => {
    const failure = new Error("mute preferences unavailable");
    const failed = queryClient({ data: null, error: failure });

    await expect(fetchInboxMutedChats("user-1", {
      client: failed.client,
      now: Date.parse("2026-08-04T12:00:00.000Z"),
    })).rejects.toBe(failure);
  });

  it("preserves valid mute preferences and their exact user-scoped query", async () => {
    const success = queryClient({
      data: [
        { chat_id: "team-1", chat_type: "team", muted_until: null },
        { chat_id: "group-1", chat_type: "group", muted_until: "2026-08-05T00:00:00.000Z" },
      ],
      error: null,
    });

    const result = await fetchInboxMutedChats("user-1", {
      client: success.client,
      now: Date.parse("2026-08-04T12:00:00.000Z"),
    });
    expect([...result.teams]).toEqual(["team-1"]);
    expect([...result.groups]).toEqual(["group-1"]);
    expect(success.from).toHaveBeenCalledWith("chat_mute_preferences");
    expect(success.builder.select).toHaveBeenCalledWith("chat_id, chat_type, muted_until");
    expect(success.builder.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("does not convert a hidden-DM preference failure into an empty map", async () => {
    const failure = new Error("hidden DM preferences unavailable");
    const failed = queryClient({ data: null, error: failure });

    await expect(fetchInboxHiddenDirectMessages("user-1", failed.client)).rejects.toBe(failure);
  });

  it("does not convert a hidden-group preference failure into an empty map", async () => {
    const failure = new Error("hidden group preferences unavailable");
    const failed = queryClient({ data: null, error: failure });

    await expect(fetchInboxHiddenGroups("user-1", failed.client)).rejects.toBe(failure);
  });

  it("maps valid hidden DM and group preferences using separate scoped tables", async () => {
    const direct = queryClient({
      data: [{ conversation_id: "dm-1", hidden_at: "2026-08-04T10:00:00.000Z" }],
      error: null,
    });
    const groups = queryClient({
      data: [{ group_id: "group-1", hidden_at: "2026-08-04T11:00:00.000Z" }],
      error: null,
    });

    await expect(fetchInboxHiddenDirectMessages("user-1", direct.client)).resolves.toEqual(
      new Map([["dm-1", "2026-08-04T10:00:00.000Z"]]),
    );
    await expect(fetchInboxHiddenGroups("user-1", groups.client)).resolves.toEqual(
      new Map([["group-1", "2026-08-04T11:00:00.000Z"]]),
    );
    expect(direct.from).toHaveBeenCalledWith("hidden_dm_conversations");
    expect(groups.from).toHaveBeenCalledWith("hidden_chat_groups");
    expect(direct.builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(groups.builder.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});
