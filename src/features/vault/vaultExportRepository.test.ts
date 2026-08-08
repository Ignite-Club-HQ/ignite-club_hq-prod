import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  collectVaultExportContents,
  fetchVaultExportFolderContents,
} from "./vaultExportRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
type QueryRecord = { table: string; filters: Array<[string, string, unknown]> };

function exportClient(rows: Record<string, unknown[]> = {}) {
  const queries: QueryRecord[] = [];
  const from = (table: string) => {
    const record: QueryRecord = { table, filters: [] };
    queries.push(record);
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = (column: string, value: unknown) => {
      record.filters.push(["eq", column, value]);
      return query;
    };
    query.is = (column: string, value: unknown) => {
      record.filters.push(["is", column, value]);
      return query;
    };
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, queries };
}

describe("Vault export folder reads", () => {
  it("uses exact team and nested-folder scope for all three tables", async () => {
    const fake = exportClient();
    await fetchVaultExportFolderContents({
      folderId: "folder-a", clubId: "club-a", teamId: "team-a", path: "Policies",
    }, fake.client);
    expect(fake.queries).toEqual([
      { table: "photos", filters: [["eq", "team_id", "team-a"], ["eq", "folder_id", "folder-a"]] },
      { table: "vault_files", filters: [["eq", "team_id", "team-a"], ["eq", "folder_id", "folder-a"]] },
      { table: "vault_folders", filters: [
        ["is", "deleted_at", null], ["eq", "team_id", "team-a"], ["eq", "parent_id", "folder-a"],
      ] },
    ]);
  });

  it("uses exact club-level scope and excludes team rows at the scope root", async () => {
    const fake = exportClient();
    await fetchVaultExportFolderContents({
      folderId: null, clubId: "club-a", teamId: null,
    }, fake.client);
    expect(fake.queries).toEqual([
      { table: "photos", filters: [
        ["eq", "club_id", "club-a"], ["is", "team_id", null], ["is", "folder_id", null],
      ] },
      { table: "vault_files", filters: [
        ["eq", "club_id", "club-a"], ["is", "team_id", null], ["is", "folder_id", null],
      ] },
      { table: "vault_folders", filters: [
        ["is", "deleted_at", null], ["eq", "club_id", "club-a"],
        ["is", "team_id", null], ["is", "parent_id", null],
      ] },
    ]);
  });

  it("preserves legacy photo/file mapping and constructs child paths", async () => {
    const fake = exportClient({
      photos: [{ id: "photo-a" }],
      vault_files: [{ id: "file-a" }],
      vault_folders: [{ id: "folder-b", name: "Medical" }],
    });
    const result = await fetchVaultExportFolderContents({
      folderId: "folder-a", clubId: "club-a", teamId: null, path: "Policies",
    }, fake.client);
    expect(result.photos).toEqual([{ id: "photo-a", path: "Policies" }]);
    expect(result.files).toEqual([{ id: "file-a", path: "Policies" }]);
    expect(result.subfolders).toEqual([{
      folder: { id: "folder-b", name: "Medical" }, path: "Policies/Medical",
    }]);
  });

  it("characterizes the existing unscoped root query without broadening it further", async () => {
    const fake = exportClient();
    await fetchVaultExportFolderContents({ folderId: null, clubId: null, teamId: null }, fake.client);
    expect(fake.queries).toEqual([
      { table: "photos", filters: [["is", "folder_id", null]] },
      { table: "vault_files", filters: [["is", "folder_id", null]] },
      { table: "vault_folders", filters: [["is", "deleted_at", null], ["is", "parent_id", null]] },
    ]);
  });

  it("walks subfolders depth-first and shares one truthful breakdown", async () => {
    const datasets: Record<string, unknown[]> = {
      photos: [{ id: "photo-a" }],
      vault_files: [{ id: "file-a" }],
      vault_folders: [{ id: "child-a", name: "Child" }],
    };
    const fake = exportClient(datasets);
    // Return the child only for the first vault_folders read to terminate recursion.
    const originalFrom = fake.client.from.bind(fake.client);
    let folderReads = 0;
    fake.client.from = ((table: string) => {
      const query = originalFrom(table) as unknown as Record<string, unknown>;
      if (table === "vault_folders") {
        folderReads += 1;
        if (folderReads > 1) datasets.vault_folders = [];
      }
      return query;
    }) as typeof fake.client.from;

    const result = await collectVaultExportContents({
      folderId: "root-a", clubId: "club-a", teamId: null,
    }, fake.client);
    expect(result.photos.map((photo) => ({ id: photo.id, path: photo.path }))).toEqual([
      { id: "photo-a", path: "" }, { id: "photo-a", path: "Child" },
    ]);
    expect(result.folderBreakdown).toEqual([
      { path: "(current folder)", photoCount: 1, fileCount: 1 },
      { path: "Child", photoCount: 1, fileCount: 1 },
    ]);
  });
});
