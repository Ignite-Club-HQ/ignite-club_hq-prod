import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchInboxAdminTeamIds,
  fetchInboxAppAdminStatus,
  fetchInboxClubProStatus,
  fetchInboxCommitteeMemberStatus,
  fetchInboxCompetitionClubMap,
  fetchInboxHiddenDirectMessages,
  fetchInboxHiddenGroups,
  fetchInboxMutedChats,
  fetchInboxUserRoles,
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

describe("messaging inbox repositories", () => {
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
