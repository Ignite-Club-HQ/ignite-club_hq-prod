import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { fetchVaultSubfolders } from "./vaultReadRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
type Call = { table: string; method: string; args: unknown[] };

function folderClient(data: unknown[]) {
  const calls: Call[] = [];
  const query: Record<string, unknown> = {};
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ table: "vault_folders", method, args });
    return query;
  };
  query.select = record("select");
  query.is = record("is");
  query.eq = record("eq");
  query.order = async (...args: unknown[]) => {
    calls.push({ table: "vault_folders", method: "order", args });
    return { data, error: null };
  };
  return {
    client: { from: () => query } as unknown as IgniteSupabaseClient,
    calls,
  };
}

const clubView = { type: "club", clubId: "club-a", clubName: "Club A" } as const;
const folder = (overrides: Record<string, unknown> = {}) => ({
  id: "folder-a",
  name: "Policies",
  restricted_roles: null,
  ...overrides,
});

describe("Vault folder read repository", () => {
  it("does not query at root or for mini-leagues, which do not support folders", async () => {
    const root = folderClient([]);
    await expect(fetchVaultSubfolders({
      view: { type: "root" },
      isAppAdmin: false,
      isClubAdmin: false,
      isCoachOrTeamAdmin: false,
      clubRoles: new Set(),
    }, root.client)).resolves.toEqual([]);
    await expect(fetchVaultSubfolders({
      view: {
        type: "mini-league",
        clubId: "club-a",
        clubName: "Club A",
        miniLeagueId: "league-a",
        miniLeagueName: "League A",
      },
      isAppAdmin: false,
      isClubAdmin: false,
      isCoachOrTeamAdmin: false,
      clubRoles: new Set(),
    }, root.client)).resolves.toEqual([]);
    expect(root.calls).toEqual([]);
  });

  it("fails closed before querying a club root without an eligible role", async () => {
    const { client, calls } = folderClient([folder()]);
    await expect(fetchVaultSubfolders({
      view: clubView,
      isAppAdmin: false,
      isClubAdmin: false,
      isCoachOrTeamAdmin: false,
      clubRoles: new Set(),
    }, client)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it("scopes a club root to the exact club, null team, null parent, and active rows", async () => {
    const { client, calls } = folderClient([folder()]);
    await fetchVaultSubfolders({
      view: clubView,
      isAppAdmin: false,
      isClubAdmin: true,
      isCoachOrTeamAdmin: true,
      clubRoles: new Set(["club_admin"]),
    }, client);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "vault_folders", method: "is", args: ["deleted_at", null] },
      { table: "vault_folders", method: "eq", args: ["club_id", "club-a"] },
      { table: "vault_folders", method: "is", args: ["team_id", null] },
      { table: "vault_folders", method: "is", args: ["parent_id", null] },
      { table: "vault_folders", method: "order", args: ["name"] },
    ]));
  });

  it("scopes a nested team folder by exact team and parent", async () => {
    const { client, calls } = folderClient([folder()]);
    await fetchVaultSubfolders({
      view: {
        type: "team",
        clubId: "club-a",
        clubName: "Club A",
        teamId: "team-a",
        teamName: "Team A",
        folderId: "parent-a",
      },
      isAppAdmin: false,
      isClubAdmin: false,
      isCoachOrTeamAdmin: true,
      clubRoles: new Set(["team_admin"]),
    }, client);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "vault_folders", method: "eq", args: ["team_id", "team-a"] },
      { table: "vault_folders", method: "eq", args: ["parent_id", "parent-a"] },
    ]));
    expect(calls.some((call) => call.method === "eq" && call.args[0] === "club_id")).toBe(false);
  });

  it("shows a coach only generic chat folders and matching restricted folders", async () => {
    const { client } = folderClient([
      folder({ id: "policies", name: "Policies" }),
      folder({ id: "images", name: "Chat Images" }),
      folder({ id: "coach", name: "Coaches Chat", restricted_roles: ["coach"] }),
      folder({ id: "admin", name: "Club Admin Chat", restricted_roles: ["club_admin"] }),
    ]);
    const result = await fetchVaultSubfolders({
      view: clubView,
      isAppAdmin: false,
      isClubAdmin: false,
      isCoachOrTeamAdmin: true,
      clubRoles: new Set(["coach"]),
    }, client);
    expect(result.map((item) => item.id)).toEqual(["images", "coach"]);
  });

  it("allows privileged viewers to retain unrestricted and restricted folders", async () => {
    const rows = [
      folder({ id: "policies" }),
      folder({ id: "admin", restricted_roles: ["club_admin"] }),
    ];
    const { client } = folderClient(rows);
    await expect(fetchVaultSubfolders({
      view: clubView,
      isAppAdmin: true,
      isClubAdmin: true,
      isCoachOrTeamAdmin: true,
      clubRoles: new Set(),
    }, client)).resolves.toEqual(rows);
  });
});
