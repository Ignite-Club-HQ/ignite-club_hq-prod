import { supabase } from "@/integrations/supabase/client";

/**
 * Auto-sync chat attachments (images and external links) to the relevant file vault.
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
    const entries: {
      file_url: string;
      name: string;
      file_type: string | null;
      is_external_link: boolean;
      file_size: number | null;
    }[] = [];

    // 1. If there's an image attachment, add it
    if (imageUrl) {
      const fileName = extractFileName(imageUrl) || `chat-attachment-${Date.now()}`;
      const fileType = guessFileType(imageUrl);
      entries.push({
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
      entries.push({
        file_url: url,
        name: fileName,
        file_type: guessFileType(url),
        is_external_link: true,
        file_size: null,
      });
    }

    if (entries.length === 0) return;

    // Check for duplicates (same file_url in same club vault)
    const urls = entries.map((e) => e.file_url);
    const { data: existing } = await supabase
      .from("vault_files")
      .select("file_url")
      .eq("club_id", clubId)
      .in("file_url", urls);

    const existingUrls = new Set((existing || []).map((e) => e.file_url));

    const newEntries = entries
      .filter((e) => !existingUrls.has(e.file_url))
      .map((e) => ({
        ...e,
        club_id: clubId,
        team_id: teamId || null,
        uploaded_by: userId,
      }));

    if (newEntries.length === 0) return;

    const { error } = await supabase.from("vault_files").insert(newEntries);
    if (error) {
      console.warn("Failed to sync chat attachment to vault:", error);
    }
  } catch (err) {
    console.warn("chatVaultSync error:", err);
  }
}

// File extensions we consider worth syncing as external links
const FILE_EXTENSIONS = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|zip|rar|txt|rtf|odt|ods|odp|png|jpg|jpeg|gif|webp|svg|mp4|mov|avi|mp3|wav)$/i;

function extractFileUrls(text: string): string[] {
  if (!text) return [];
  const urlRegex = /(?:https?:\/\/)[^\s]+/gi;
  const matches = text.match(urlRegex) || [];
  // Only include URLs that look like files (have a file extension) or are Google Drive links
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
