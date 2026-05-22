import { Capacitor } from "@capacitor/core";
import { safeOpenUrl } from "./safeOpenUrl";

/**
 * Open a remote file (PDF, docx, etc.) in the most user-friendly way.
 *
 * On native: download the file to the cache directory and hand it off to the
 * system's native viewer via @capacitor-community/file-opener. This avoids
 * showing the raw Supabase storage URL in an in-app browser chrome (which
 * looks unbranded and exposes internal URLs to the user).
 *
 * On web (or if the native open fails): fall back to safeOpenUrl which
 * handles signed-URL resolution + Capacitor Browser / window.open.
 */
export async function safeOpenFile(
  url: string,
  opts: { fileName?: string; mimeType?: string } = {},
): Promise<void> {
  const isNative = Capacitor.isNativePlatform();

  if (!isNative) {
    await safeOpenUrl(url);
    return;
  }

  // Resolve signed URL up-front for private Supabase buckets so the download
  // request is actually authorized.
  let resolvedUrl = url;
  try {
    if (url.includes("/storage/v1/object/")) {
      const { resolveSignedUrl } = await import("@/hooks/useSignedPhotoUrl");
      resolvedUrl = await resolveSignedUrl(url);
    }
  } catch (err) {
    console.warn("[safeOpenFile] failed to resolve signed URL:", err);
  }

  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { FileOpener } = await import("@capacitor-community/file-opener");

    // Build a safe-ish filename in the cache directory.
    const guessedName = opts.fileName?.trim() || guessFileNameFromUrl(resolvedUrl);
    const safeName = `vault-${Date.now()}-${sanitizeFileName(guessedName)}`;

    const dl = await Filesystem.downloadFile({
      url: resolvedUrl,
      path: safeName,
      directory: Directory.Cache,
    });

    const localPath =
      dl.path ||
      (await Filesystem.getUri({ path: safeName, directory: Directory.Cache })).uri;

    if (!localPath) throw new Error("Download produced no local path");

    await FileOpener.open({
      filePath: localPath,
      contentType: opts.mimeType || guessMimeFromName(guessedName),
      openWithDefault: true,
    });
  } catch (err) {
    console.warn("[safeOpenFile] native open failed, falling back to browser:", err);
    await safeOpenUrl(resolvedUrl);
  }
}

function guessFileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "file";
    return decodeURIComponent(last);
  } catch {
    return "file";
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
}

function guessMimeFromName(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "csv":
      return "text/csv";
    case "txt":
      return "text/plain";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}
