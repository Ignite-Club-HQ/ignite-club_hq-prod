import { Capacitor } from "@capacitor/core";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { toast } from "sonner";
import { resolveSignedUrl } from "@/hooks/useSignedPhotoUrl";

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
          await Media.savePhoto({
            path: resolvedUrl,
            fileName: baseName,
            albumIdentifier,
          });
          toast.success("Photo downloaded", { id: toastId, description: "Saved to your photos" });
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
          await Filesystem.writeFile({
            path: filename,
            data: base64,
            directory: Directory.Documents,
            recursive: true,
          });
          toast.success("Photo downloaded", { id: toastId, description: "Saved to app documents" });
          return;
        }
      }

      // ---- iOS (and Android fallback): write to cache then open share sheet
      let writtenUri: string | null = null;
      try {
        const dl: any = await (Filesystem as any).downloadFile({
          url: resolvedUrl,
          path: filename,
          directory: Directory.Cache,
          recursive: true,
        });
        writtenUri = dl?.path || dl?.uri || null;
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
        writtenUri = written.uri;
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
              await Share.share({ title: "Save photo", url: finalUri, dialogTitle: "Save photo" });
            } catch (shareErr: any) {
              const msg = String(shareErr?.message || shareErr);
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
    const filename = `${friendlyBaseName}-${stamp}.${ext}`;

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
      action: {
        label: "Open",
        onClick: () => {
          // Open synchronously inside the click handler so popup blockers allow it.
          const win = window.open(blobUrl, "_blank", "noopener");
          if (!win) {
            // Popup blocked — navigate the current tab as a fallback.
            window.location.href = blobUrl;
          }
        },
      },
    });
  } catch (err) {
    console.warn("[downloadImage] blob download failed, falling back to open:", err);
    safeOpenUrl(resolvedUrl);
    toast.success("Photo opened in new tab", { id: toastId });
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
  } catch {}
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
  } catch (err: any) {
    const message = String(err?.message || err).toLowerCase();
    if (!message.includes("already exists")) throw err;
  }

  const created = await findAlbum();
  if (!created?.identifier) throw new Error("Could not prepare Android photo album");
  return created.identifier;
}
