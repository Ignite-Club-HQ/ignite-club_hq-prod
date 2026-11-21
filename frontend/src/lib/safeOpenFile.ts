import { Capacitor } from "@capacitor/core";
import { FileOpener } from "@capacitor-community/file-opener";
import { toast } from "sonner";

export type FileOptions = { fileName?: string; mimeType?: string };
type FileAction = "open" | "download" | "share";
const operations = new Map<string, Promise<void>>();

export function safeOpenFile(url: string, opts: FileOptions = {}): Promise<void> {
  return runFileAction("open", url, opts);
}

export function runFileAction(action: FileAction, url: string, opts: FileOptions = {}): Promise<void> {
  const current = operations.get(url);
  if (current) return current;
  // Reserve the web viewing tab inside the original tap, before authorization awaits.
  const tab = action === "open" && !Capacitor.isNativePlatform() ? window.open("", "_blank") : null;
  const promise = performFileAction(action, url, opts, tab).finally(() => operations.delete(url));
  operations.set(url, promise);
  return promise;
}

/** Shared visible dispatch used by chat and Vault, including explicit recovery commands. */
export async function presentFileAction(action: FileAction, url: string, opts: FileOptions = {}): Promise<void> {
  if (operations.has(url)) return;
  const progress = toast.loading(action === "open" ? "Preparing file to open…" : action === "download" ? "Preparing file to save…" : "Preparing file to share…");
  try {
    await runFileAction(action, url, opts);
  } catch (error) {
    const message = error instanceof Error ? error.message : "We couldn't prepare this file. Please try again.";
    toast.error(message, {
      action: { label: "Download", onClick: () => { void presentFileAction("download", url, opts); } },
      cancel: { label: "Share", onClick: () => { void presentFileAction("share", url, opts); } },
      duration: 12000,
    });
  } finally { toast.dismiss(progress); }
}

type LocalCopy = {
  /** file:// URI (or native path) of the cached copy. */
  uri: string;
  /** Content type reported by the server when we fetched the bytes ourselves. */
  serverContentType: string | null;
};

/**
 * Open a remote file (PDF, docx, etc.) in the most user-friendly way.
 *
 * Native pipeline (Android / iOS):
 *   1. Resolve an authorized signed URL for Supabase storage files (fail closed).
 *   2. Download to the app cache under the file's REAL name so the OS viewer
 *      shows "Club policy.pdf" rather than a storage host name. We try the
 *      native downloader first and fall back to fetch + write, because
 *      Filesystem.downloadFile is known to fail on some devices / signed URLs.
 *   3. Hand the local copy to the OS viewer with its real MIME type.
 *   4. Never substitute sharing for opening. PDF-only browser fallback is authorized.
 * Download exports a separate accessible copy; Share is explicitly selected.
 *
 * Security: for recognized Supabase storage URLs we resolve to an authorized
 * signed URL BEFORE any download or browser operation. If signing fails we
 * fail closed — the raw private URL is never downloaded, opened, or passed to
 * the browser fallback, and no tokens or private URLs are included in errors.
 */
async function performFileAction(
  action: FileAction,
  url: string,
  opts: FileOptions,
  tab: Window | null,
): Promise<void> {
  const isNative = Capacitor.isNativePlatform();
  // Resolve authorization AND ICP decryption before any viewer/download.
  // Older competition uploads saved "storage://<bucket>/<path>"; map it to the
  // standard storage link so it is signed like every other stored file.
  if (url.startsWith("storage://")) {
    const rest = url.slice("storage://".length);
    const slash = rest.indexOf("/");
    if (slash < 1) { tab?.close(); throw new Error("This file link is incomplete. Ask the organiser to upload it again."); }
    const { supabase } = await import("@/integrations/supabase/client");
    // icp-guard: allow getPublicUrl only builds a URL string locally for legacy storage:// links; no network call
    url = supabase.storage.from(rest.slice(0, slash)).getPublicUrl(rest.slice(slash + 1)).data.publicUrl;
  }
  let resolvedUrl = url;
  {
    try {
      const { resolveSignedUrl } = await import("@/hooks/useSignedPhotoUrl");
      resolvedUrl = await resolveSignedUrl(url, { expiresIn: 120 });
    } catch {
      // Do not include the raw URL, tokens, or the underlying error message
      // (which may contain sensitive query params) in the thrown error.
      console.warn("[safeOpenFile] authorization/unlock failed; refusing to open stored file");
      tab?.close();
      throw new Error("You couldn't access this file. Sign in again or ask the organiser to check your access.");
    }
  }

  const guessedName = opts.fileName?.trim() || guessFileNameFromUrl(url);
  const displayName = withExtension(sanitizeFileName(guessedName), url);
  const nameType = guessMimeFromName(displayName);
  const documentType = normalizeMimeType(nameType) || normalizeMimeType(opts.mimeType);

  if (!isNative) {
    if (action === "download") {
      const { downloadResolvedFile } = await import("./downloadStoredFile");
      await downloadResolvedFile(resolvedUrl, displayName, documentType || undefined);
    } else if (action === "share") {
      const response = await fetch(resolvedUrl);
      if (!response.ok) throw fileFetchError(response.status);
      const file = new File([await response.blob()], displayName, { type: documentType || "application/octet-stream" });
      if (!navigator.canShare?.({ files: [file] })) throw new Error("File sharing isn't available in this browser. Choose Download instead.");
      // File fetching may consume user activation (especially Safari). The final
      // explicit command starts the platform sheet synchronously from a new tap.
      toast("File ready to share", { duration: 60000, action: { label: "Share", onClick: () => {
        void navigator.share({ files: [file], title: displayName }).catch(error => {
          if (!isUserCancel(error)) toast.error("We couldn't share this file. Try Download instead.");
        });
      } } });
    } else {
      if (!tab) throw new Error("Your browser blocked the file window. Allow pop-ups for Ignite and try Open again.");
      try {
        const response = await fetch(resolvedUrl, { headers: { Range: "bytes=0-0" } });
        if (!response.ok) throw fileFetchError(response.status);
        await response.body?.cancel();
      } catch (error) {
        tab.close();
        throw error instanceof DocumentFileError ? error : new Error("We couldn't load this file. Check your connection and try again.");
      }
      tab.opener = null;
      tab.location.href = resolvedUrl;
    }
    return;
  }

  // Build a safe filename in a unique cache sub-directory so the viewer
  // shows the real document name (not a timestamped/mangled one).
  const relativePath = `ignite-files/${crypto.randomUUID()}/${displayName}`;

  let local: LocalCopy | null = null;
  try {
    local = await downloadToCache(resolvedUrl, relativePath, displayName);
  } catch (err) {
    throw err instanceof DocumentFileError ? err : new Error("This file could not be saved for viewing. Check your connection and try again.");
  }

  if (!local) {
    throw new Error("This file could not be saved for viewing. Please try again.");
  }

  const primaryType =
    documentType || normalizeMimeType(local.serverContentType) || "application/octet-stream";

  if (action === "download") {
    const { NativeFileExport } = await import("./nativeFileExport");
    try {
      const result = await NativeFileExport.save({ filePath: local.uri, fileName: displayName, mimeType: primaryType });
      toast.success(result.saved ? "File saved to your selected location" : "Save cancelled");
    } catch { throw new Error("We couldn't save this file. Choose a writable location and try again."); }
    return;
  }
  if (action === "share") {
    if (!(await shareLocalFile(local.uri, displayName))) throw new Error("We couldn't share this file. Please try again.");
    return;
  }

  if (await openWithViewer(local.uri, primaryType)) return;

  if (primaryType === "application/pdf" && /^https?:\/\//.test(resolvedUrl)) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: resolvedUrl });
      return;
    } catch { /* Explicit recovery below; browser launch is not proof of PDF rendering. */ }
  }
  throw new Error("No compatible viewer could open this file. Install a document viewer, or choose Download or Share.");
}

class DocumentFileError extends Error {}
function fileFetchError(status: number): Error {
  return new DocumentFileError(status === 401 || status === 403
    ? "Access to this file was refused or the link expired. Sign in again and retry."
    : status === 404 ? "This file is missing. Ask the organiser to upload it again."
    : "We couldn't download this file. Check your connection and try again.");
}

/**
 * Download the remote file into the app cache. Tries the native downloader
 * first, then a fetch + write fallback (the same strategy downloadImage uses
 * because Filesystem.downloadFile is unreliable on some Android builds and
 * with some signed URLs). Throws only when every strategy fails.
 */
async function downloadToCache(
  url: string,
  relativePath: string,
  displayName: string,
): Promise<LocalCopy> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");

  // Strategy 1: native download straight to disk.
  try {
    // Object URLs exist only inside the WebView. Native HTTP downloaders
    // cannot read them; write the decrypted bytes through the fetch path.
    if (url.startsWith("blob:")) throw new Error("Use WebView bytes for object URLs");
    const dl = (await Filesystem.downloadFile({
      url,
      path: relativePath,
      directory: Directory.Cache,
      recursive: true,
    })) as { path?: string; uri?: string };
    let uri = dl?.path || dl?.uri || null;
    if (!uri) {
      uri = (await Filesystem.getUri({ path: relativePath, directory: Directory.Cache })).uri;
    }
    if (uri) {
      // Confirm bytes actually landed — some builds resolve with a path but
      // write nothing (e.g. HTTP errors swallowed by the native downloader).
      let size = -1;
      try {
        size = (await Filesystem.stat({ path: relativePath, directory: Directory.Cache })).size ?? -1;
      } catch {
        size = -1; // stat unsupported here; trust the downloader
      }
      if (size !== 0) return { uri, serverContentType: null };
    }
    console.warn("[safeOpenFile] native download produced no readable file; trying fetch");
  } catch (err) {
    console.warn("[safeOpenFile] Filesystem.downloadFile failed, trying fetch:", describeError(err));
  }

  // Strategy 2: fetch the bytes in the WebView and write them ourselves.
  const response = await fetch(url);
  if (!response.ok) throw fileFetchError(response.status);
  const blob = await response.blob();
  if (blob.size === 0) throw new DocumentFileError("This file is empty. Ask the organiser to upload it again.");
  const serverContentType =
    (blob.type || response.headers.get("content-type") || "").split(";")[0].trim() || null;
  const base64 = await blobToBase64(blob);

  const writeAt = async (path: string) => {
    const written = await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    return written.uri || (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
  };

  try {
    const uri = await writeAt(relativePath);
    if (uri) return { uri, serverContentType };
  } catch (err) {
    console.warn("[safeOpenFile] nested cache write failed, trying flat path:", describeError(err));
  }

  // Strategy 3: flat cache path (some Filesystem builds mishandle nested
  // directories). Keep the real name at the end so the viewer still shows it.
  const uri = await writeAt(`ignite-${Date.now()}-${displayName}`);
  if (!uri) throw new Error("Cache write produced no local path");
  return { uri, serverContentType };
}

/** Android ACTION_VIEW chooser; iOS native document preview. Never ACTION_SEND. */
async function openWithViewer(localPath: string, primaryType: string): Promise<boolean> {
  try {
    await FileOpener.open({ filePath: localPath, contentType: primaryType, openWithDefault: Capacitor.getPlatform() !== "android" });
    return true;
  } catch { return false; }
}

/** Offer the OS share sheet for the cached copy (keeps the real file name). */
async function shareLocalFile(localPath: string, title: string): Promise<boolean> {
  try {
    const { Share } = await import("@capacitor/share");
    await Share.share({ title, files: [localPath] });
    return true;
  } catch (err) {
    // User dismissing the sheet also rejects — that's still "handled".
    if (isUserCancel(err)) return true;
    console.warn("[safeOpenFile] share fallback failed:", describeError(err));
    return false;
  }
}

function isUserCancel(err: unknown): boolean {
  const msg = describeError(err).toLowerCase();
  return msg.includes("cancel") || msg.includes("dismiss");
}

function describeError(err: unknown): string {
  if (!err) return "unknown";
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && "message" in (err as Record<string, unknown>)) {
    return String((err as Record<string, unknown>).message);
  }
  return String(err);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Accept only real MIME types ("type/subtype"). Vault records sometimes store
 * bare extensions ("pdf") in file_type, which native viewers reject.
 */
function normalizeMimeType(value?: string | null): string | null {
  const v = (value || "").trim().toLowerCase().split(";")[0].trim();
  if (!v || v === "application/octet-stream") return null;
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(v)) return null;
  return v;
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
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "").slice(-80) || "file";
}

export function guessMimeFromName(name: string): string {
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
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "mp3":
      return "audio/mpeg";
    case "zip":
      return "application/zip";
    case "rtf": return "application/rtf";
    case "odt": return "application/vnd.oasis.opendocument.text";
    case "ods": return "application/vnd.oasis.opendocument.spreadsheet";
    case "odp": return "application/vnd.oasis.opendocument.presentation";
    case "json": return "application/json";
    case "html": return "text/html";
    case "ics": return "text/calendar";
    case "wav": return "audio/wav";
    case "m4a": return "audio/mp4";
    case "ogg": return "audio/ogg";
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
