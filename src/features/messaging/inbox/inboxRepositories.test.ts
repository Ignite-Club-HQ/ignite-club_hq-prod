import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  fetchInboxAppAdminStatus,
  fetchInboxClubProStatus,
  fetchInboxCompetitionClubMap,
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
});
