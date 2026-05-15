import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { toast } from "sonner";
import { resolveSignedUrl } from "@/hooks/useSignedPhotoUrl";
import type { DownloadFileResult } from "@capacitor/filesystem";

type DownloadResultWithLegacyUri = DownloadFileResult & { uri?: string };

/**
 * Download an image without exposing the backend URL or storage filename
 * to the user. Fetches the image as a blob and saves it under a friendly
 * filename (e.g. "ignite-photo-2026-04-22.jpg").
 *
 * On Android native: saves directly to the user's photo library via MediaStore.
 * This must not use the Share plugin; the download action should not open the
 * Android share sheet.
 *
 * UX: shows a loading toast while the download is in progress, then a
 * success toast (with an "Open" action where applicable) or an error toast.
 */
export async function downloadImage(url: string, friendlyBaseName = "ignite-photo"): Promise<void> {
  const toastId = toast.loading("Downloading photo…");
  try {
    await downloadImageInner(url, friendlyBaseName, toastId);
  } catch (err) {
    console.warn("[downloadImage] failed:", err);
    toast.error("Download failed", { id: toastId, description: "Please try again" });
  }
}

async function downloadImageInner(url: string, friendlyBaseName: string, toastId: string | number): Promise<void> {
  const stamp = new Date().toISOString().split("T")[0];
  const resolvedUrl = await resolveSignedUrl(url);

  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform(); // "ios" | "android"
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");

      const urlExt = guessExtensionFromUrl(resolvedUrl);
      let filename = `${friendlyBaseName}-${stamp}-${Date.now()}.${urlExt}`;

      // ---- Android: save directly to the media library. Capacitor Filesystem
      // cannot place images in public Photos/Downloads on Android 10+ because
      // of scoped storage; using Share here is not a download and creates the
      // exact wrong UX. The Media plugin writes through Android MediaStore.
      if (platform === "android") {
        try {
          const { Media } = await import("@capacitor-community/media");
          const baseName = `${friendlyBaseName}-${stamp}-${Date.now()}`;
          const albumIdentifier = await ensureAndroidMediaAlbum(Media, "Ignite");
          const saved = await Media.savePhoto({
            path: resolvedUrl,
            fileName: baseName,
            albumIdentifier,
          }) as { filePath?: string };
          showOpenDownloadedPhotoToast(toastId, saved.filePath || null, "Saved to your photos", pickContentTypeFromExtension(urlExt));
          return;
        } catch (androidErr) {
          console.warn("[downloadImage] Android MediaStore save failed:", androidErr);
          const response = await fetch(resolvedUrl);
          if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
          const blob = await response.blob();
          const contentType = blob.type || response.headers.get("content-type") || "image/jpeg";
          const ext = pickExtension(contentType);
          filename = `${friendlyBaseName}-${stamp}-${Date.now()}.${ext}`;
          const base64 = await blobToBase64(blob);
          const written = await Filesystem.writeFile({
            path: filename,
            data: base64,
            directory: Directory.Documents,
            recursive: true,
          });
          showOpenDownloadedPhotoToast(toastId, written.uri || null, "Saved to app documents", contentType);
          return;
        }
      }

      if (platform === "ios") {
        const { Media } = await import("@capacitor-community/media");
        const ext = guessExtensionFromUrl(resolvedUrl);
        const contentType = pickContentTypeFromExtension(ext);
        const iosFilename = `${friendlyBaseName}-${stamp}-${Date.now()}.${ext}`;
        let localPath: string | null = null;

        const saveToPhotos = async (path: string, source: string): Promise<boolean> => {
          try {
            await Media.savePhoto({ path });
            toast.success("Saved to Photos", {
              id: toastId,
              description: "Open your Photos app to view it",
            });
            return true;
          } catch (mediaErr: unknown) {
            if (isPhotoPermissionError(mediaErr)) {
              toast.error("Photos permission needed", {
                id: toastId,
                description: "Enable Photos access for Ignite in iOS Settings to save downloads.",
              });
              return true;
            }
            console.warn(`[downloadImage] iOS Media.savePhoto failed from ${source}:`, mediaErr);
            return false;
          }
        };

        // First let the native Media plugin download the signed HTTPS URL and
        // write it straight to Photos. This avoids WKWebView fetch/CORS issues.
        if (await saveToPhotos(resolvedUrl, "remote URL")) return;

        // Fallback 1: native URLSession download to app cache, then save the
        // cached bytes as a data URI. Capacitor Filesystem returns `path` on
        // native (not `uri`), so support both shapes.
        try {
          const dl = await Filesystem.downloadFile({
            url: resolvedUrl,
            path: iosFilename,
            directory: Directory.Cache,
            recursive: true,
          }) as DownloadResultWithLegacyUri;
          localPath = dl?.uri || dl?.path || null;
        } catch (nativeErr) {
          console.warn("[downloadImage] iOS Filesystem.downloadFile failed, falling back to fetch:", nativeErr);
        }

        if (localPath) {
          try {
            const read = await Filesystem.readFile({ path: iosFilename, directory: Directory.Cache });
            const dataUri = await fileReadResultToDataUri(read.data, contentType);
            if (await saveToPhotos(dataUri, "cached data URI")) return;
          } catch (readErr) {
            console.warn("[downloadImage] iOS cached file read failed:", readErr);
          }

          if (await saveToPhotos(localPath, "local file")) return;
        }

        // Fallback 2: WebView fetch. This can fail for cross-origin storage
        // URLs, but when it works we again pass a data URI rather than a local
        // file path to avoid iOS plugin path handling inconsistencies.
        try {
          const response = await CapacitorHttp.get({
            url: resolvedUrl,
            responseType: "arraybuffer",
            connectTimeout: 15000,
            readTimeout: 30000,
          });
          if (response.status < 200 || response.status >= 300) {
            throw new Error(`Native HTTP failed (${response.status})`);
          }
          const responseType = getHeaderValue(response.headers, "content-type") || contentType;
          const dataUri = normalizeBase64DataUri(response.data, responseType);
          if (await saveToPhotos(dataUri, "native HTTP data URI")) return;
        } catch (httpErr) {
          console.warn("[downloadImage] iOS native HTTP fallback failed:", httpErr);
        }

        try {
          const response = await fetch(resolvedUrl, { credentials: "omit" });
          if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
          const blob = await response.blob();
          const dataUri = `data:${blob.type || contentType};base64,${await blobToBase64(blob)}`;
          if (await saveToPhotos(dataUri, "fetch data URI")) return;
        } catch (fetchErr) {
          console.warn("[downloadImage] iOS fetch fallback failed:", fetchErr);
        }

        // Last resort: share the cached local file if one exists, otherwise give
        // a truthful error. This path should only be reached if both native
        // save/download mechanisms and the WebView fetch failed.
        if (localPath) {
          try {
            const { Share } = await import("@capacitor/share");
            await Share.share({
              title: "Save photo",
              files: [localPath],
              dialogTitle: "Save photo",
            });
            toast.success("Photo ready", {
              id: toastId,
              description: "Tap Save Image in the share sheet",
            });
          } catch (shareErr: unknown) {
            const msg = getErrorText(shareErr).toLowerCase();
            if (msg.includes("cancel") || msg.includes("abort")) {
              toast.dismiss(toastId);
              return;
            }
            console.warn("[downloadImage] iOS share fallback failed:", shareErr);
            toast.error("Download failed", { id: toastId, description: "Please try again" });
          }
          return;
        }

        toast.error("Download failed", { id: toastId, description: "Could not save this photo. Please try again." });
        return;
      }

      // ---- Other native fallback: write to cache then open share sheet
      let writtenUri: string | null = null;
      try {
        const dl = await Filesystem.downloadFile({
          url: resolvedUrl,
          path: filename,
          directory: Directory.Cache,
          recursive: true,
        }) as DownloadResultWithLegacyUri;
        writtenUri = dl?.uri || dl?.path || null;
        if (!writtenUri) {
          const uriResult = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
          writtenUri = uriResult.uri;
        }
      } catch (dlErr) {
        console.warn("[downloadImage] Filesystem.downloadFile failed, trying fetch:", dlErr);
      }

      if (!writtenUri) {
        const response = await fetch(resolvedUrl);
        if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
        const blob = await response.blob();
        const contentType = blob.type || response.headers.get("content-type") || "image/jpeg";
        const ext = pickExtension(contentType);
        filename = `${friendlyBaseName}-${stamp}-${Date.now()}.${ext}`;
        const base64 = await blobToBase64(blob);
        const written = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
          recursive: true,
        });
        writtenUri = written.uri || (await Filesystem.getUri({ path: filename, directory: Directory.Cache })).uri;
      }

      const finalUri = writtenUri;
      if (!finalUri) {
        toast.error("Download failed", { id: toastId, description: "Could not save file" });
        return;
      }
      toast.success("Photo downloaded", {
        id: toastId,
        description: "Tap Open to save or share",
        action: {
          label: "Open",
          onClick: async () => {
            try {
              const { Share } = await import("@capacitor/share");
              await Share.share({
                title: "Save photo",
                text: "Save photo",
                url: finalUri,
                files: [finalUri],
                dialogTitle: "Save photo",
              });
            } catch (shareErr: unknown) {
              const msg = getErrorText(shareErr);
              if (!msg.toLowerCase().includes("cancel")) {
                console.warn("[downloadImage] share failed:", shareErr);
                toast.error("Could not open file", { description: msg });
              }
            }
          },
        },
      });
      return;
    } catch (err) {
      console.warn("[downloadImage] native download failed:", err);
      toast.error("Download failed", { id: toastId, description: "Please try again" });
      return;
    }
  }

  try {
    const response = await fetch(resolvedUrl, { credentials: "omit" });
    if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
    const blob = await response.blob();

    const contentType = blob.type || response.headers.get("content-type") || "";
    const ext = pickExtension(contentType);
    const filename = `${friendlyBaseName}-${stamp}-${Date.now()}.${ext}`;

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Keep blob URL alive so the toast "Open" action still works after the download.
    // Revoke it after a longer delay (toast lifetime + buffer).
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    toast.success("Photo downloaded", {
      id: toastId,
      description: filename,
    });
  } catch (err) {
    console.warn("[downloadImage] blob download failed, falling back to open:", err);
    safeOpenUrl(resolvedUrl);
    toast.success("Photo opened in new tab", { id: toastId });
  }
}

function showOpenDownloadedPhotoToast(
  toastId: string | number,
  filePath: string | null,
  description: string,
  _contentType: string,
) {
  toast.success("Photo downloaded", {
    id: toastId,
    description,
    action: filePath
      ? {
          label: "Open",
          onClick: async (event) => {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            // Launch the system Gallery / Photos app. We don't try to open the
            // exact saved file by path: Android's MediaStore returns paths /
            // content URIs that FileOpener typically can't resolve across
            // scoped-storage boundaries. Opening the gallery is reliable and
            // surfaces the brand-new photo at the top of the user's library.
            try {
              const { AppLauncher } = await import("@capacitor/app-launcher");
              // Try the standard gallery intent first, then fall back to known
              // gallery package URLs.
              const candidates = [
                "content://media/external/images/media",
                "content://media/internal/images/media",
              ];
              for (const url of candidates) {
                try {
                  const opened = await AppLauncher.openUrl({ url });
                  if (opened?.completed) return;
                } catch {
                  // try next
                }
              }
              throw new Error("No gallery app could be launched");
            } catch (openErr: unknown) {
              console.warn("[downloadImage] gallery launch failed:", openErr);
              toast.error("Could not open gallery", {
                description: "Open your Photos app from the home screen",
              });
            }
          },
        }
      : undefined,
  });
}


function pickContentTypeFromExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // strip data:*/*;base64, prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fileReadResultToDataUri(data: string | Blob, contentType: string): Promise<string> {
  if (typeof data === "string") {
    return data.startsWith("data:") ? data : `data:${contentType};base64,${data}`;
  }

  return `data:${data.type || contentType};base64,${await blobToBase64(data)}`;
}

function isPhotoPermissionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null | undefined;
  const message = String(e?.message || err || "").toLowerCase();
  const code = String(e?.code || "").toLowerCase();

  return (
    code.includes("access_denied") ||
    message.includes("access to photos not allowed") ||
    message.includes("permission") ||
    message.includes("denied") ||
    message.includes("not authorized")
  );
}

function getErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "");
}

function getHeaderValue(headers: Record<string, string>, name: string): string | null {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value;
  }
  return null;
}

function normalizeBase64DataUri(data: unknown, contentType: string): string {
  if (typeof data === "string") {
    return data.startsWith("data:") ? data : `data:${contentType};base64,${data}`;
  }

  throw new Error("Native HTTP did not return base64 image data");
}

function pickExtension(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("heic")) return "heic";
  if (ct.includes("heif")) return "heif";
  if (ct.includes("svg")) return "svg";
  return "jpg";
}

function guessExtensionFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const m = path.match(/\.(png|webp|gif|heic|heif|svg|jpg|jpeg)(?:$|\?)/);
    if (m) return m[1] === "jpeg" ? "jpg" : m[1];
  } catch {
    return "jpg";
  }
  return "jpg";
}

async function ensureAndroidMediaAlbum(
  Media: {
    getAlbums: () => Promise<{ albums?: Array<{ name?: string; identifier?: string }> }>;
    createAlbum: (options: { name: string }) => Promise<void>;
    getAlbumsPath?: () => Promise<{ path?: string }>;
  },
  albumName: string,
): Promise<string> {
  const findAlbum = async () => {
    const { albums = [] } = await Media.getAlbums();
    const albumsPath = Media.getAlbumsPath ? (await Media.getAlbumsPath().catch(() => ({ path: undefined }))).path : undefined;
    return albums.find((album) =>
      album.name === albumName &&
      album.identifier &&
      (!albumsPath || album.identifier.startsWith(albumsPath))
    ) || albums.find((album) => album.name === albumName && album.identifier);
  };

  const existing = await findAlbum();
  if (existing?.identifier) return existing.identifier;

  try {
    await Media.createAlbum({ name: albumName });
  } catch (err: unknown) {
    const message = getErrorText(err).toLowerCase();
    if (!message.includes("already exists")) throw err;
  }

  const created = await findAlbum();
  if (!created?.identifier) throw new Error("Could not prepare Android photo album");
  return created.identifier;
}
