import { Capacitor } from "@capacitor/core";
import { safeOpenUrl } from "@/lib/safeOpenUrl";

/**
 * Download an image without exposing the backend URL or storage filename
 * to the user. Fetches the image as a blob and saves it under a friendly
 * filename (e.g. "ignite-photo-2026-04-22.jpg").
 *
 * On native (Capacitor), falls back to opening the URL in the system browser
 * so the OS handles the save flow — blob downloads aren't reliable in WebView.
 */
export async function downloadImage(url: string, friendlyBaseName = "ignite-photo"): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    safeOpenUrl(url);
    return;
  }

  try {
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
    const blob = await response.blob();

    // Pick an extension from the response's content-type when available,
    // otherwise default to .jpg.
    const contentType = blob.type || response.headers.get("content-type") || "";
    const ext = pickExtension(contentType);

    const stamp = new Date().toISOString().split("T")[0];
    const filename = `${friendlyBaseName}-${stamp}.${ext}`;

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoke after a tick so the browser has time to start the download.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    console.warn("[downloadImage] blob download failed, falling back to open:", err);
    safeOpenUrl(url);
  }
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
