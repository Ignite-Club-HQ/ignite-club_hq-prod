import { Capacitor } from "@capacitor/core";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { toast } from "@/hooks/use-toast";

/**
 * Download an image without exposing the backend URL or storage filename
 * to the user. Fetches the image as a blob and saves it under a friendly
 * filename (e.g. "ignite-photo-2026-04-22.jpg").
 *
 * On native (Capacitor): writes the file directly to the device's Documents
 * directory (visible in the Files app on iOS, Documents folder on Android).
 * No share sheet is shown.
 */
export async function downloadImage(url: string, friendlyBaseName = "ignite-photo"): Promise<void> {
  const stamp = new Date().toISOString().split("T")[0];

  if (Capacitor.isNativePlatform()) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
      const blob = await response.blob();
      const contentType = blob.type || response.headers.get("content-type") || "";
      const ext = pickExtension(contentType);
      const filename = `${friendlyBaseName}-${stamp}-${Date.now()}.${ext}`;

      const base64 = await blobToBase64(blob);

      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      });

      toast({
        title: "Photo saved",
        description: `Saved as ${filename} in your Documents folder`,
      });
      return;
    } catch (err) {
      console.warn("[downloadImage] native download failed, falling back to open:", err);
      toast({
        title: "Download failed",
        description: "Opening image in browser instead",
        variant: "destructive",
      });
      safeOpenUrl(url);
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
