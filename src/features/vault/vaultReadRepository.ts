import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { VaultFolderView } from "./types";
import { filterVisibleVaultFolders, getVaultScope } from "./vaultScope";

type IgniteSupabaseClient = SupabaseClient<Database>;
export type VaultFolderRow = Database["public"]["Tables"]["vault_folders"]["Row"];
export type VaultFileRow = Database["public"]["Tables"]["vault_files"]["Row"];
export type VaultFolderTreeRow = Pick<
  VaultFolderRow,
  "id" | "name" | "parent_id" | "restricted_roles"
>;
export type VaultFolderTree = {
  descendants: VaultFolderTreeRow[];
  pathById: Map<string, string>;
  descendantIds: string[];
};
export type VaultPhotoItem = VaultFileRow & {
  image_url: VaultFileRow["file_url"];
  uploader_id: VaultFileRow["uploaded_by"];
  title: VaultFileRow["name"];
};

const IMAGE_FILE_EXTENSION = /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|heif|tiff|tif)$/i;

export function isVaultImage(item: Pick<VaultFileRow, "file_type" | "name" | "file_url">): boolean {
  return Boolean(
    item.file_type?.startsWith("image/") ||
    IMAGE_FILE_EXTENSION.test(item.name || item.file_url || ""),
  );
}

export function partitionVaultItems(items: readonly VaultFileRow[] | null | undefined): {
  photos: VaultPhotoItem[];
  files: VaultFileRow[];
} {
  const photos: VaultPhotoItem[] = [];
  const files: VaultFileRow[] = [];
  for (const item of items ?? []) {
    if (isVaultImage(item)) {
      photos.push({
        ...item,
        image_url: item.file_url,
        uploader_id: item.uploaded_by,
        title: item.name,
      });
    } else {
      files.push(item);
    }
  }
  return { photos, files };
}

export function buildVaultFolderTree(
  folders: readonly VaultFolderTreeRow[],
  startFolderId: string | null,
  options: {
    isPrivilegedViewer: boolean;
    clubRoles: ReadonlySet<string>;
  },
): VaultFolderTree {
  const visible = folders.filter((folder) => {
    if (!folder.restricted_roles?.length) return true;
    if (options.isPrivilegedViewer) return true;
    return folder.restricted_roles.some((role) => options.clubRoles.has(role));
  });

  const childMap = new Map<string | null, VaultFolderTreeRow[]>();
  for (const folder of visible) {
    const siblings = childMap.get(folder.parent_id) ?? [];
    siblings.push(folder);
    childMap.set(folder.parent_id, siblings);
  }

  const descendants: VaultFolderTreeRow[] = [];
  const pathById = new Map<string, string>();
  const stack: Array<{ id: string | null; path: string }> = [
    { id: startFolderId, path: "" },
  ];
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    for (const child of childMap.get(current.id) ?? []) {
      const path = current.path ? `${current.path} / ${child.name}` : child.name;
      descendants.push(child);
      pathById.set(child.id, path);
      stack.push({ id: child.id, path });
    }
  }

  return { descendants, pathById, descendantIds: descendants.map((folder) => folder.id) };
}

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

export async function fetchVaultItems(
  options: {
    view: VaultFolderView;
    isClubAdmin: boolean;
    isCoachOrTeamAdmin: boolean;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultFileRow[]> {
  const { view } = options;
  if (view.type === "root") return [];
  const scope = getVaultScope(view);
  let query = client.from("vault_files").select("*").is("deleted_at", null);

  if (view.type === "club") {
    if (!options.isClubAdmin && !options.isCoachOrTeamAdmin) return [];
    query = query
      .eq("club_id", view.clubId)
      .is("team_id", null)
      .is("mini_league_id", null);
    if (!options.isClubAdmin && options.isCoachOrTeamAdmin && !scope.folderId) return [];
  } else if (view.type === "team") {
    query = query.eq("team_id", view.teamId);
  } else {
    query = query.eq("mini_league_id", view.miniLeagueId);
  }

  query = scope.folderId
    ? query.eq("folder_id", scope.folderId)
    : query.is("folder_id", null);
  const { data } = await query.order("created_at", { ascending: false });
  return data ?? [];
}

export async function fetchVaultFolderTree(
  options: {
    view: VaultFolderView;
    isPrivilegedViewer: boolean;
    clubRoles: ReadonlySet<string>;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultFolderTree> {
  const empty = (): VaultFolderTree => ({
    descendants: [],
    pathById: new Map(),
    descendantIds: [],
  });
  if (options.view.type !== "club" && options.view.type !== "team") return empty();

  const scope = getVaultScope(options.view);
  let query = client
    .from("vault_folders")
    .select("id,name,parent_id,restricted_roles");
  query = options.view.type === "club"
    ? query.eq("club_id", scope.clubId).is("team_id", null)
    : query.eq("team_id", scope.teamId);
  const { data } = await query;
  return buildVaultFolderTree(data ?? [], scope.folderId, options);
}
