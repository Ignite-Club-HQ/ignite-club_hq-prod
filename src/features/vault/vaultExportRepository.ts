/** Canonical, scoped reads for recursive Vault exports. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { isVaultImageItem } from "./vaultItemClassification";

type IgniteSupabaseClient = SupabaseClient<Database>;
type VaultFileRow = Database["public"]["Tables"]["vault_files"]["Row"];
type VaultFolderRow = Database["public"]["Tables"]["vault_folders"]["Row"];
type VaultExportPhoto = VaultFileRow & {
  path: string;
  image_url: string;
  uploader_id: string | null;
  title: string;
};

export interface VaultExportOptions {
  folderId: string | null;
  clubId: string | null;
  teamId: string | null;
  path?: string;
}

export interface VaultExportFolderContents {
  photos: VaultExportPhoto[];
  files: Array<VaultFileRow & { path: string }>;
  subfolders: Array<{ folder: VaultFolderRow; path: string }>;
}

export interface VaultExportCollection {
  photos: VaultExportFolderContents["photos"];
  files: VaultExportFolderContents["files"];
  folderBreakdown: Array<{ path: string; photoCount: number; fileCount: number }>;
}

export const hasVaultExportScope = (
  scope: Pick<VaultExportOptions, "clubId" | "teamId">,
): boolean => Boolean(scope.teamId || scope.clubId);

function applyScope<T extends { eq: Function; is: Function }>(
  query: T,
  options: Pick<VaultExportOptions, "clubId" | "teamId">,
): T {
  if (options.teamId) return query.eq("team_id", options.teamId) as T;
  return query.eq("club_id", options.clubId).is("team_id", null) as T;
}

export async function fetchVaultExportFolderContents(
  options: VaultExportOptions,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultExportFolderContents> {
  if (!hasVaultExportScope(options)) {
    return { photos: [], files: [], subfolders: [] };
  }

  const path = options.path ?? "";
  let filesQuery = client.from("vault_files").select("*").is("deleted_at", null);
  filesQuery = applyScope(filesQuery, options);
  filesQuery = options.folderId
    ? filesQuery.eq("folder_id", options.folderId)
    : filesQuery.is("folder_id", null);
  const { data: folderItems } = await filesQuery;

  let foldersQuery = client.from("vault_folders").select("*").is("deleted_at", null);
  foldersQuery = applyScope(foldersQuery, options);
  foldersQuery = options.folderId
    ? foldersQuery.eq("parent_id", options.folderId)
    : foldersQuery.is("parent_id", null);
  const { data: childFolders } = await foldersQuery;

  const items = folderItems ?? [];
  return {
    photos: items.filter(isVaultImageItem).map((item) => ({
      ...item,
      path,
      image_url: item.file_url,
      uploader_id: item.uploaded_by,
      title: item.name,
    })),
    files: items.filter((item) => !isVaultImageItem(item)).map((item) => ({ ...item, path })),
    subfolders: (childFolders ?? []).map((folder) => ({
      folder,
      path: path ? `${path}/${folder.name}` : folder.name,
    })),
  };
}

export async function collectVaultExportContents(
  options: VaultExportOptions,
  client: IgniteSupabaseClient = supabase,
  folderBreakdown: VaultExportCollection["folderBreakdown"] = [],
): Promise<VaultExportCollection> {
  if (!hasVaultExportScope(options)) {
    return { photos: [], files: [], folderBreakdown: [] };
  }

  const path = options.path ?? "";
  const contents = await fetchVaultExportFolderContents({ ...options, path }, client);
  folderBreakdown.push({
    path: path || "(current folder)",
    photoCount: contents.photos.length,
    fileCount: contents.files.length,
  });

  const photos = [...contents.photos];
  const files = [...contents.files];
  for (const subfolder of contents.subfolders) {
    const nested = await collectVaultExportContents({
      folderId: subfolder.folder.id,
      clubId: options.clubId,
      teamId: options.teamId,
      path: subfolder.path,
    }, client, folderBreakdown);
    photos.push(...nested.photos);
    files.push(...nested.files);
  }
  return { photos, files, folderBreakdown };
}
