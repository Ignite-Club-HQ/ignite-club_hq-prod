import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { fetchVaultItems, fetchVaultSubfolders, isVaultImage, partitionVaultItems } from "./vaultReadRepository";

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

function fileClient(data: unknown[]) {
  const calls: Call[] = [];
  const query: Record<string, unknown> = {};
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ table: "vault_files", method, args });
    return query;
  };
  query.select = record("select");
  query.is = record("is");
  query.eq = record("eq");
  query.order = async (...args: unknown[]) => {
    calls.push({ table: "vault_files", method: "order", args });
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

describe("Vault active-item read model", () => {
  it("classifies images by MIME type or supported filename/URL extension", () => {
    expect(isVaultImage({ file_type: "image/jpeg", name: "no-extension", file_url: "url" })).toBe(true);
    expect(isVaultImage({ file_type: null, name: "PHOTO.HEIC", file_url: "url" })).toBe(true);
    // Existing behaviour gives a present filename precedence over the URL.
    expect(isVaultImage({ file_type: "application/octet-stream", name: "download", file_url: "path/photo.webp" })).toBe(false);
    expect(isVaultImage({ file_type: "application/octet-stream", name: null, file_url: "path/photo.webp" })).toBe(true);
    expect(isVaultImage({ file_type: "application/pdf", name: "policy.pdf", file_url: "url" })).toBe(false);
  });

  it("maps photo compatibility fields without changing document rows", () => {
    const image = { id: "image-a", file_type: "image/png", name: "Photo", file_url: "url-a", uploaded_by: "user-a" };
    const document = { id: "file-a", file_type: "application/pdf", name: "Policy.pdf", file_url: "url-b", uploaded_by: "user-b" };
    const result = partitionVaultItems([image, document] as never[]);
    expect(result.photos).toEqual([expect.objectContaining({
      id: "image-a",
      image_url: "url-a",
      uploader_id: "user-a",
      title: "Photo",
    })]);
    expect(result.files).toEqual([document]);
  });

  it("returns stable empty partitions for absent data", () => {
    expect(partitionVaultItems(undefined)).toEqual({ photos: [], files: [] });
  });

  it("fails closed before querying club files for a user without a qualifying role", async () => {
    const { client, calls } = fileClient([]);
    await expect(fetchVaultItems({
      view: clubView,
      isClubAdmin: false,
      isCoachOrTeamAdmin: false,
    }, client)).resolves.toEqual([]);
    expect(calls.some((call) => call.method === "order")).toBe(false);
  });

  it("does not expose loose club-root files to a coach", async () => {
    const { client, calls } = fileClient([]);
    await expect(fetchVaultItems({
      view: clubView,
      isClubAdmin: false,
      isCoachOrTeamAdmin: true,
    }, client)).resolves.toEqual([]);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "vault_files", method: "eq", args: ["club_id", "club-a"] },
      { table: "vault_files", method: "is", args: ["team_id", null] },
      { table: "vault_files", method: "is", args: ["mini_league_id", null] },
    ]));
    expect(calls.some((call) => call.method === "order")).toBe(false);
  });

  it("allows scoped coach files inside an explicit club folder", async () => {
    const rows = [{ id: "file-a", name: "Chat file" }];
    const { client, calls } = fileClient(rows);
    await expect(fetchVaultItems({
      view: { ...clubView, folderId: "chat-folder" },
      isClubAdmin: false,
      isCoachOrTeamAdmin: true,
    }, client)).resolves.toEqual(rows);
    expect(calls).toEqual(expect.arrayContaining([
      { table: "vault_files", method: "eq", args: ["folder_id", "chat-folder"] },
      { table: "vault_files", method: "order", args: ["created_at", { ascending: false }] },
    ]));
  });

  it("uses mutually exclusive exact team and mini-league scopes", async () => {
    const team = fileClient([]);
    await fetchVaultItems({
      view: {
        type: "team",
        clubId: "club-a",
        clubName: "Club A",
        teamId: "team-a",
        teamName: "Team A",
      },
      isClubAdmin: false,
      isCoachOrTeamAdmin: true,
    }, team.client);
    expect(team.calls).toContainEqual({ table: "vault_files", method: "eq", args: ["team_id", "team-a"] });
    expect(team.calls.some((call) => call.args[0] === "mini_league_id")).toBe(false);

    const league = fileClient([]);
    await fetchVaultItems({
      view: {
        type: "mini-league",
        clubId: "club-a",
        clubName: "Club A",
        miniLeagueId: "league-a",
        miniLeagueName: "League A",
      },
      isClubAdmin: false,
      isCoachOrTeamAdmin: false,
    }, league.client);
    expect(league.calls).toContainEqual({ table: "vault_files", method: "eq", args: ["mini_league_id", "league-a"] });
    expect(league.calls.some((call) => call.args[0] === "team_id")).toBe(false);
  });
});
