import { supabase } from "@/integrations/supabase/client";

/**
 * Auto-sync chat attachments (images and external links) to the relevant file vault,
 * organized into "Chat Images" and "Chat Links" subfolders.
 * Called fire-and-forget after a chat message is successfully sent.
 */
export async function syncChatAttachmentToVault({
  imageUrl,
  text,
  userId,
  clubId,
  teamId,
}: {
  imageUrl: string | null;
  text: string;
  userId: string;
  clubId: string;
  teamId?: string | null;
}) {
  try {
    const imageEntries: {
      file_url: string;
      name: string;
      file_type: string | null;
      is_external_link: boolean;
      file_size: number | null;
    }[] = [];

    const linkEntries: typeof imageEntries = [];

    // 1. If there's an image attachment, add it
    if (imageUrl) {
      const fileName = extractFileName(imageUrl) || `chat-attachment-${Date.now()}`;
      const fileType = guessFileType(imageUrl);
      imageEntries.push({
        file_url: imageUrl,
        name: fileName,
        file_type: fileType,
        is_external_link: false,
        file_size: null,
      });
    }

    // 2. Extract any URLs from the message text that look like files/documents
    const fileUrls = extractFileUrls(text);
    for (const url of fileUrls) {
      const fileName = extractFileName(url) || url;
      linkEntries.push({
        file_url: url,
        name: fileName,
        file_type: guessFileType(url),
        is_external_link: true,
        file_size: null,
      });
    }

    if (imageEntries.length === 0 && linkEntries.length === 0) return;

    // Check for duplicates
    const allUrls = [...imageEntries, ...linkEntries].map((e) => e.file_url);
    const { data: existing } = await supabase
      .from("vault_files")
      .select("file_url")
      .eq("club_id", clubId)
      .in("file_url", allUrls);

    const existingUrls = new Set((existing || []).map((e) => e.file_url));

    // Insert images into "Chat Images" folder (team-level if teamId, club-level otherwise)
    const newImages = imageEntries.filter((e) => !existingUrls.has(e.file_url));
    if (newImages.length > 0) {
      const folderId = await getOrCreateFolder(clubId, "Chat Images", userId, teamId || null);
      const rows = newImages.map((e) => ({
        ...e,
        club_id: clubId,
        team_id: teamId || null,
        uploaded_by: userId,
        folder_id: folderId,
      }));
      const { error } = await supabase.from("vault_files").insert(rows);
      if (error) console.warn("Failed to sync chat images to vault:", error);
    }

    // Insert links into "Chat Links" folder (team-level if teamId, club-level otherwise)
    const newLinks = linkEntries.filter((e) => !existingUrls.has(e.file_url));
    if (newLinks.length > 0) {
      const folderId = await getOrCreateFolder(clubId, "Chat Links", userId, teamId || null);
      const rows = newLinks.map((e) => ({
        ...e,
        club_id: clubId,
        team_id: teamId || null,
        uploaded_by: userId,
        folder_id: folderId,
      }));
      const { error } = await supabase.from("vault_files").insert(rows);
      if (error) console.warn("Failed to sync chat links to vault:", error);
    }
  } catch (err) {
    console.warn("chatVaultSync error:", err);
  }
}

// Cache folder IDs per club to avoid repeated lookups within a session
const folderCache = new Map<string, string>();

async function getOrCreateFolder(clubId: string, folderName: string, userId: string, teamId?: string | null): Promise<string | null> {
  const cacheKey = `${clubId}:${teamId || "club"}:${folderName}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)!;

  let query = supabase
    .from("vault_folders")
    .select("id")
    .eq("club_id", clubId)
    .eq("name", folderName)
    .is("parent_id", null);

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.is("team_id", null);
  }

  const { data } = await query.maybeSingle();

  if (data) {
    folderCache.set(cacheKey, data.id);
    return data.id;
  }

  const insertData = { club_id: clubId, name: folderName, created_by: userId, team_id: teamId || null };

  const { data: newFolder, error } = await supabase
    .from("vault_folders")
    .insert(insertData as any)
    .select("id")
    .single();

  if (error || !newFolder) {
    console.warn("Failed to create vault folder:", error);
    return null;
  }

  folderCache.set(cacheKey, newFolder.id);
  return newFolder.id;
}

// File extensions we consider worth syncing as external links
const FILE_EXTENSIONS = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|zip|rar|txt|rtf|odt|ods|odp|png|jpg|jpeg|gif|webp|svg|mp4|mov|avi|mp3|wav)$/i;

function extractFileUrls(text: string): string[] {
  if (!text) return [];
  const urlRegex = /(?:https?:\/\/)[^\s]+/gi;
  const matches = text.match(urlRegex) || [];
  return matches.filter(
    (url) =>
      FILE_EXTENSIONS.test(url) ||
      url.includes("drive.google.com") ||
      url.includes("docs.google.com") ||
      url.includes("sheets.google.com") ||
      url.includes("slides.google.com") ||
      url.includes("dropbox.com")
  );
}

function extractFileName(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && last.includes(".")) {
      return decodeURIComponent(last);
    }
    return null;
  } catch {
    return null;
  }
}

function guessFileType(url: string): string | null {
  const lower = url.toLowerCase();
  if (/\.(jpg|jpeg)/.test(lower)) return "image/jpeg";
  if (/\.png/.test(lower)) return "image/png";
  if (/\.gif/.test(lower)) return "image/gif";
  if (/\.webp/.test(lower)) return "image/webp";
  if (/\.pdf/.test(lower)) return "application/pdf";
  if (/\.doc(x)?/.test(lower)) return "application/msword";
  if (/\.xls(x)?/.test(lower)) return "application/vnd.ms-excel";
  if (/\.ppt(x)?/.test(lower)) return "application/vnd.ms-powerpoint";
  if (/\.csv/.test(lower)) return "text/csv";
  if (/\.mp4/.test(lower)) return "video/mp4";
  if (/\.mp3/.test(lower)) return "audio/mpeg";
  if (url.includes("drive.google.com") || url.includes("docs.google.com")) return "link/google-drive";
  if (url.includes("dropbox.com")) return "link/dropbox";
  return null;
}
