import { Capacitor } from "@capacitor/core";
import { safeOpenUrl } from "./safeOpenUrl";

/**
 * Recognized Supabase storage URL forms that require authorization before
 * download/open. Kept in sync with the classifier used by resolveSignedUrl.
 */
const PRIVATE_STORAGE_MARKERS = [
  "/storage/v1/object/public/",
  "/storage/v1/object/sign/",
  "/storage/v1/object/authenticated/",
  "/storage/v1/render/image/public/",
  "/storage/v1/render/image/sign/",
];

function isSupabaseStorageUrl(url: string): boolean {
  const clean = url.split("?")[0].split("#")[0];
  return PRIVATE_STORAGE_MARKERS.some((m) => clean.includes(m));
}

/**
 * Open a remote file (PDF, docx, etc.) in the most user-friendly way.
 *
 * Security: for recognized Supabase storage URLs we resolve to an authorized
 * signed URL BEFORE any download or browser operation. If signing fails we
 * fail closed — the raw private URL is never downloaded, opened, or passed to
 * the browser fallback, and no tokens or private URLs are included in errors.
 */
export async function safeOpenFile(
  url: string,
  opts: { fileName?: string; mimeType?: string } = {},
): Promise<void> {
  const isNative = Capacitor.isNativePlatform();
  const isStorageUrl = isSupabaseStorageUrl(url);

  // Resolve signed URL up-front for Supabase storage URLs. Fail closed on
  // signing errors so we never expose or download the raw private URL.
  let resolvedUrl = url;
  if (isStorageUrl) {
    try {
      const { resolveSignedUrl } = await import("@/hooks/useSignedPhotoUrl");
      resolvedUrl = await resolveSignedUrl(url);
    } catch {
      // Do not include the raw URL, tokens, or the underlying error message
      // (which may contain sensitive query params) in the thrown error.
      console.warn("[safeOpenFile] signing failed; refusing to open private file");
      throw new Error("This file could not be authorized for viewing. Please try again.");
    }
  }

  if (!isNative) {
    await safeOpenUrl(resolvedUrl);
    return;
  }

  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { FileOpener } = await import("@capacitor-community/file-opener");

    // Build a safe filename in a unique cache sub-directory so the viewer
    // shows the real document name (not a timestamped/mangled one).
    const guessedName = opts.fileName?.trim() || guessFileNameFromUrl(resolvedUrl);
    const displayName = withExtension(sanitizeFileName(guessedName), resolvedUrl);
    const safeName = `ignite-files/${Date.now()}/${displayName}`;

    const dl = await Filesystem.downloadFile({
      url: resolvedUrl,
      path: safeName,
      directory: Directory.Cache,
      recursive: true,
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
    // Fall back to browser using the RESOLVED URL only — never the raw
    // private URL. For successfully signed private URLs this passes the
    // signed URL along; for external/public URLs this preserves the
    // existing behaviour.
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

/**
 * Ensure the local file keeps a sensible extension so the OS picks the right
 * viewer — falls back to the extension from the remote URL path.
 */
function withExtension(name: string, url: string): string {
  if (/\.[a-zA-Z0-9]{1,8}$/.test(name)) return name;
  const fromUrl = guessFileNameFromUrl(url);
  const m = fromUrl.match(/\.[a-zA-Z0-9]{1,8}$/);
  return m ? `${name}${m[0]}` : name;
}
