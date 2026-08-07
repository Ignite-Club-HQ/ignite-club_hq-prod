import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;

async function updateName(
  table: "vault_folders" | "vault_files",
  id: string,
  name: string,
  client: IgniteSupabaseClient,
): Promise<void> {
  const { error } = await client.from(table).update({ name }).eq("id", id);
  if (error) throw error;
}

export function renameVaultFolder(
  folderId: string,
  newName: string,
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  return updateName("vault_folders", folderId, newName, client);
}

export function renameVaultItem(
  fileId: string,
  newName: string,
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  return updateName("vault_files", fileId, newName, client);
}

export async function moveVaultFile(
  options: {
    fileId: string;
    targetFolderId: string | null;
    targetTeamId?: string | null;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  const update: { folder_id: string | null; team_id?: string | null } = {
    folder_id: options.targetFolderId,
  };
  if (options.targetTeamId !== undefined) update.team_id = options.targetTeamId;

  const { error } = await client
    .from("vault_files")
    .update(update)
    .eq("id", options.fileId);
  if (error) throw error;
}
