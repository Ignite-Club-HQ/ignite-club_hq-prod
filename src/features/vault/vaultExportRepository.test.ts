import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  collectVaultExportContents,
  fetchVaultExportFolderContents,
  hasVaultExportScope,
} from "./vaultExportRepository";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

type IgniteSupabaseClient = SupabaseClient<Database>;
type Row = Record<string, unknown> & { id: string };

function makeClient(data: Record<string, Row[]>) {
  const calls: Array<{ table: string; filters: string[] }> = [];
  const client = {
    from(table: string) {
      const call = { table, filters: [] as string[] };
      calls.push(call);
      let rows = [...(data[table] ?? [])];
      const query = {
        select: () => query,
        is: (column: string, value: unknown) => {
          call.filters.push(`${column} IS ${String(value).toUpperCase()}`);
          rows = rows.filter((row) => (row[column] ?? null) === value);
          return query;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push(`${column}=${String(value)}`);
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
      };
      return query;
    },
  };
  return { client: client as unknown as IgniteSupabaseClient, calls };
}

const clubId = "club-1";
const items: Row[] = [
  { id: "image", name: "team.jpg", file_url: "image.jpg", file_type: "image/jpeg", folder_id: null, club_id: clubId, team_id: null, deleted_at: null, uploaded_by: "user-1" },
  { id: "extension-image", name: "team.PNG", file_url: "image", file_type: null, folder_id: null, club_id: clubId, team_id: null, deleted_at: null, uploaded_by: null },
  { id: "document", name: "rules.pdf", file_url: "rules.pdf", file_type: "application/pdf", folder_id: null, club_id: clubId, team_id: null, deleted_at: null },
  { id: "deleted", name: "gone.jpg", file_url: "gone.jpg", file_type: "image/jpeg", folder_id: null, club_id: clubId, team_id: null, deleted_at: "2026-01-01" },
  { id: "nested", name: "nested.jpg", file_url: "nested.jpg", file_type: "image/jpeg", folder_id: "folder-1", club_id: clubId, team_id: null, deleted_at: null, uploaded_by: null },
  { id: "other-club", name: "other.jpg", file_url: "other.jpg", file_type: "image/jpeg", folder_id: null, club_id: "club-2", team_id: null, deleted_at: null },
  { id: "team", name: "team.jpg", file_url: "team.jpg", file_type: "image/jpeg", folder_id: null, club_id: clubId, team_id: "team-1", deleted_at: null, uploaded_by: null },
];
const folders: Row[] = [
  { id: "folder-1", name: "Gallery Uploads", parent_id: null, club_id: clubId, team_id: null, deleted_at: null },
];

describe("Vault export folder reads", () => {
  it("uses vault_files as the only item source and excludes soft-deleted rows", async () => {
    const fake = makeClient({ vault_files: items, vault_folders: [] });
    const result = await fetchVaultExportFolderContents({ folderId: null, clubId, teamId: null }, fake.client);
    expect(fake.calls.map(({ table }) => table)).not.toContain("photos");
    expect(result.photos.map(({ id }) => id)).toEqual(["image", "extension-image"]);
    expect(result.files.map(({ id }) => id)).toEqual(["document"]);
  });

  it("uses exact club-level scope and excludes team rows", async () => {
    const fake = makeClient({ vault_files: items, vault_folders: [] });
    await fetchVaultExportFolderContents({ folderId: null, clubId, teamId: null }, fake.client);
    expect(fake.calls[0].filters).toEqual([
      "deleted_at IS NULL", `club_id=${clubId}`, "team_id IS NULL", "folder_id IS NULL",
    ]);
  });

  it("uses exact team scope", async () => {
    const fake = makeClient({ vault_files: items, vault_folders: [] });
    const result = await fetchVaultExportFolderContents({ folderId: null, clubId, teamId: "team-1" }, fake.client);
    expect(fake.calls[0].filters).toContain("team_id=team-1");
    expect(result.photos.map(({ id }) => id)).toEqual(["team"]);
  });

  it("uses exact nested-folder scope and preserves its export path", async () => {
    const fake = makeClient({ vault_files: items, vault_folders: [] });
    const result = await fetchVaultExportFolderContents({ folderId: "folder-1", clubId, teamId: null, path: "Gallery Uploads" }, fake.client);
    expect(fake.calls[0].filters).toContain("folder_id=folder-1");
    expect(result.photos.map(({ id, path }) => ({ id, path }))).toEqual([{ id: "nested", path: "Gallery Uploads" }]);
  });

  it("exports a mirrored gallery item exactly once with a truthful breakdown", async () => {
    const fake = makeClient({ vault_files: items, vault_folders: folders });
    const result = await collectVaultExportContents({ folderId: null, clubId, teamId: null }, fake.client);
    expect(result.photos.filter(({ id }) => id === "nested")).toHaveLength(1);
    expect(result.folderBreakdown).toEqual([
      { path: "(current folder)", photoCount: 2, fileCount: 1 },
      { path: "Gallery Uploads", photoCount: 1, fileCount: 0 },
    ]);
  });

  it("fails closed and performs zero queries without club or team scope", async () => {
    const fake = makeClient({ vault_files: items, vault_folders: folders });
    const result = await collectVaultExportContents({ folderId: null, clubId: null, teamId: null }, fake.client);
    expect(result).toEqual({ photos: [], files: [], folderBreakdown: [] });
    expect(fake.calls).toHaveLength(0);
    expect(hasVaultExportScope({ clubId: null, teamId: null })).toBe(false);
  });
});
