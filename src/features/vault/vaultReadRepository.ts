import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { VaultFolderView } from "./types";
import { filterVisibleVaultFolders, getVaultScope } from "./vaultScope";

type IgniteSupabaseClient = SupabaseClient<Database>;
export type VaultFolderRow = Database["public"]["Tables"]["vault_folders"]["Row"];

export async function fetchVaultSubfolders(
  options: {
    view: VaultFolderView;
    isAppAdmin: boolean;
    isClubAdmin: boolean;
    isCoachOrTeamAdmin: boolean;
    clubRoles: ReadonlySet<string>;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultFolderRow[]> {
  const { view } = options;
  if (view.type === "root" || view.type === "mini-league") return [];
  if (
    view.type === "club" &&
    !options.isClubAdmin &&
    !options.isCoachOrTeamAdmin &&
    options.clubRoles.size === 0
  ) {
    return [];
  }

  const scope = getVaultScope(view);
  let query = client.from("vault_folders").select("*").is("deleted_at", null);

  if (view.type === "club") {
    query = query.eq("club_id", scope.clubId).is("team_id", null);
  } else {
    query = query.eq("team_id", scope.teamId);
  }

  query = scope.folderId
    ? query.eq("parent_id", scope.folderId)
    : query.is("parent_id", null);

  const { data } = await query.order("name");
  return filterVisibleVaultFolders(data ?? [], {
    isPrivilegedViewer: options.isAppAdmin || options.isClubAdmin,
    restrictClubRootToChatFolders:
      view.type === "club" && !options.isClubAdmin && options.isCoachOrTeamAdmin,
    clubRoles: options.clubRoles,
  });
}
