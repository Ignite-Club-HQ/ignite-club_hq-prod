import { Capacitor } from "@capacitor/core";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { toast } from "@/hooks/use-toast";

/**
 * Download an image without exposing the backend URL or storage filename
 * to the user. Fetches the image as a blob and saves it under a friendly
 * filename (e.g. "ignite-photo-2026-04-22.jpg").
 *
 * On Android native: saves directly to the user's photo library via MediaStore.
 * This must not use the Share plugin; the download action should not open the
 * Android share sheet.
 */
export async function downloadImage(url: string, friendlyBaseName = "ignite-photo"): Promise<void> {
  const stamp = new Date().toISOString().split("T")[0];

  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform(); // "ios" | "android"
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");

      const urlExt = guessExtensionFromUrl(url);
      let filename = `${friendlyBaseName}-${stamp}-${Date.now()}.${urlExt}`;

      // ---- Android: save directly to the media library. Capacitor Filesystem
      // cannot place images in public Photos/Downloads on Android 10+ because
      // of scoped storage; using Share here is not a download and creates the
      // exact wrong UX. The Media plugin writes through Android MediaStore.
      if (platform === "android") {
        try {
          const { Media } = await import("@capacitor-community/media");
          const baseName = `${friendlyBaseName}-${stamp}-${Date.now()}`;
          await Media.savePhoto({
            path: url,
            fileName: baseName,
          });
          toast({ title: "Photo downloaded", description: "Saved to your photos" });
          return;
        } catch (androidErr) {
          console.warn("[downloadImage] Android MediaStore save failed:", androidErr);
          try {
            const response = await fetch(url);
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
            toast({ title: "Photo downloaded", description: "Saved to app documents" });
          } catch (fallbackErr) {
            console.warn("[downloadImage] Android document fallback failed:", fallbackErr);
            toast({
              title: "Download failed",
              description: "Please try again",
              variant: "destructive",
            });
          }
          return;
        }
      }

      // ---- iOS (and Android fallback): write to cache then open share sheet
      let writtenUri: string | null = null;
      try {
        const dl: any = await (Filesystem as any).downloadFile({
          url,
          path: filename,
          directory: Directory.Cache,
          recursive: true,
        });
        writtenUri = dl?.path || dl?.uri || null;
      } catch (dlErr) {
        console.warn("[downloadImage] Filesystem.downloadFile failed, trying fetch:", dlErr);
      }

      if (!writtenUri) {
        const response = await fetch(url);
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

      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({
          title: "Save photo",
          url: writtenUri,
          dialogTitle: "Save photo",
        });
        toast({ title: "Photo ready", description: "Choose where to save it" });
      } catch (shareErr: any) {
        if (String(shareErr?.message || shareErr).toLowerCase().includes("cancel")) return;
        throw shareErr;
      }
      return;
    } catch (err) {
      console.warn("[downloadImage] native download failed:", err);
      toast({
        title: "Download failed",
        description: "Please try again",
        variant: "destructive",
      });
      return;
    }
  }

  try {
    const response = await fetch(url, { credentials: "omit" });
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
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    console.warn("[downloadImage] blob download failed, falling back to open:", err);
    safeOpenUrl(url);
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
