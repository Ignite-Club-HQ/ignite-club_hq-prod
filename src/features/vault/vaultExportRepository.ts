import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;
type PhotoRow = Database["public"]["Tables"]["photos"]["Row"];
type VaultFileRow = Database["public"]["Tables"]["vault_files"]["Row"];
type VaultFolderRow = Database["public"]["Tables"]["vault_folders"]["Row"];

export interface VaultExportFolderContents {
  photos: Array<PhotoRow & { path: string }>;
  files: Array<VaultFileRow & { path: string }>;
  subfolders: Array<{ folder: VaultFolderRow; path: string }>;
}

export async function fetchVaultExportFolderContents(
  options: {
    folderId: string | null;
    clubId: string | null;
    teamId: string | null;
    path?: string;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultExportFolderContents> {
  const path = options.path ?? "";

  let photosQuery = client.from("photos").select("*");
  if (options.teamId) photosQuery = photosQuery.eq("team_id", options.teamId);
  else if (options.clubId) photosQuery = photosQuery.eq("club_id", options.clubId).is("team_id", null);
  photosQuery = options.folderId
    ? photosQuery.eq("folder_id", options.folderId)
    : photosQuery.is("folder_id", null);
  const { data: folderPhotos } = await photosQuery;

  let filesQuery = client.from("vault_files").select("*");
  if (options.teamId) filesQuery = filesQuery.eq("team_id", options.teamId);
  else if (options.clubId) filesQuery = filesQuery.eq("club_id", options.clubId).is("team_id", null);
  filesQuery = options.folderId
    ? filesQuery.eq("folder_id", options.folderId)
    : filesQuery.is("folder_id", null);
  const { data: folderFiles } = await filesQuery;

  let subfoldersQuery = client.from("vault_folders").select("*").is("deleted_at", null);
  if (options.teamId) subfoldersQuery = subfoldersQuery.eq("team_id", options.teamId);
  else if (options.clubId) subfoldersQuery = subfoldersQuery.eq("club_id", options.clubId).is("team_id", null);
  subfoldersQuery = options.folderId
    ? subfoldersQuery.eq("parent_id", options.folderId)
    : subfoldersQuery.is("parent_id", null);
  const { data: childFolders } = await subfoldersQuery;

  return {
    photos: (folderPhotos ?? []).map((photo) => ({ ...photo, path })),
    files: (folderFiles ?? []).map((file) => ({ ...file, path })),
    subfolders: (childFolders ?? []).map((folder) => ({
      folder,
      path: path ? `${path}/${folder.name}` : folder.name,
    })),
  };
}

export interface VaultExportCollection {
  photos: VaultExportFolderContents["photos"];
  files: VaultExportFolderContents["files"];
  folderBreakdown: Array<{ path: string; photoCount: number; fileCount: number }>;
}

export async function collectVaultExportContents(
  options: {
    folderId: string | null;
    clubId: string | null;
    teamId: string | null;
    path?: string;
  },
  client: IgniteSupabaseClient = supabase,
  folderBreakdown: VaultExportCollection["folderBreakdown"] = [],
): Promise<VaultExportCollection> {
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
