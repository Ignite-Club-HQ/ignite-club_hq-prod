import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { moveVaultFile, renameVaultFolder, renameVaultItem } from "./vaultMutationRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
type Write = { table: string; payload: unknown; filters: Array<[string, unknown]> };

function mutationClient(error: unknown = null) {
  const writes: Write[] = [];
  const from = (table: string) => {
    let write: Write;
    const query: Record<string, unknown> = {};
    query.update = (payload: unknown) => {
      write = { table, payload, filters: [] };
      writes.push(write);
      return query;
    };
    query.eq = (column: string, value: unknown) => {
      write.filters.push([column, value]);
      return query;
    };
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: null, error }).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, writes };
}

describe("Vault rename and move repository", () => {
  it("renames only the exact folder row", async () => {
    const fake = mutationClient();
    await renameVaultFolder("folder-a", "Policies", fake.client);
    expect(fake.writes).toEqual([{
      table: "vault_folders",
      payload: { name: "Policies" },
      filters: [["id", "folder-a"]],
    }]);
  });

  it("uses the same exact vault_files contract for photo and document names", async () => {
    const fake = mutationClient();
    await renameVaultItem("file-a", "Rules.pdf", fake.client);
    await renameVaultItem("photo-a", "Final photo", fake.client);
    expect(fake.writes).toEqual([
      { table: "vault_files", payload: { name: "Rules.pdf" }, filters: [["id", "file-a"]] },
      { table: "vault_files", payload: { name: "Final photo" }, filters: [["id", "photo-a"]] },
    ]);
  });

  it("moves within folders without altering team scope when targetTeamId is omitted", async () => {
    const fake = mutationClient();
    await moveVaultFile({ fileId: "file-a", targetFolderId: "folder-b" }, fake.client);
    expect(fake.writes[0]).toEqual({
      table: "vault_files",
      payload: { folder_id: "folder-b" },
      filters: [["id", "file-a"]],
    });
    expect(fake.writes[0]?.payload).not.toHaveProperty("team_id");
  });

  it("can explicitly move a file to a team or clear its team", async () => {
    const fake = mutationClient();
    await moveVaultFile({ fileId: "file-a", targetFolderId: null, targetTeamId: "team-b" }, fake.client);
    await moveVaultFile({ fileId: "file-b", targetFolderId: null, targetTeamId: null }, fake.client);
    expect(fake.writes.map((write) => write.payload)).toEqual([
      { folder_id: null, team_id: "team-b" },
      { folder_id: null, team_id: null },
    ]);
  });

  it("propagates the original database failure without claiming success", async () => {
    const denied = { code: "42501", message: "permission denied" };
    const fake = mutationClient(denied);
    await expect(renameVaultItem("file-a", "Denied", fake.client)).rejects.toBe(denied);
  });
});
