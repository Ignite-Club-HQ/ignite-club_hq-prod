import { Capacitor } from "@capacitor/core";

/**
 * Chunked base64-to-Blob conversion.
 * Processes data in 8 KB slices so large iOS photos (HEIC, 10 MB+)
 * never hit the ~65 K call-stack limit that String.fromCharCode(...spread)
 * or a single massive atob() → Uint8Array loop can trigger.
 */

const SLICE_SIZE = 8192; // 8 KB per chunk

export function base64ToBlob(base64String: string, mimeType: string): Blob {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);

  for (let offset = 0; offset < len; offset += SLICE_SIZE) {
    const end = Math.min(offset + SLICE_SIZE, len);
    for (let i = offset; i < end; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
  }

  return new Blob([bytes], { type: mimeType });
}

/** Common native photo format → MIME mapping */
export const PHOTO_FORMAT_TO_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

/** MIME → file extension (defaults to jpg) */
export function mimeToExtension(mimeType: string): string {
  const t = mimeType.toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("gif")) return "gif";
  if (t.includes("webp")) return "webp";
  if (t.includes("heic")) return "heic";
  if (t.includes("heif")) return "heif";
  return "jpg";
}

const normalizeBase64String = (base64String: string): string => {
  const withoutDataUrlPrefix = base64String.includes(",")
    ? base64String.split(",")[1]
    : base64String;

  const normalized = withoutDataUrlPrefix
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const paddingNeeded = normalized.length % 4;
  if (paddingNeeded === 0) return normalized;

  return normalized.padEnd(normalized.length + (4 - paddingNeeded), "=");
};

interface CameraPhotoLike {
  base64String?: string | null;
  webPath?: string;
  path?: string;
  format?: string | null;
}

export async function cameraPhotoToBlob(photo: CameraPhotoLike): Promise<{
  blob: Blob;
  mimeType: string;
  extension: string;
  previewUrl: string;
}> {
  console.log("[cameraPhotoToBlob] START", {
    hasBase64: !!photo.base64String,
    base64Length: photo.base64String?.length ?? 0,
    webPath: photo.webPath ?? "(none)",
    path: photo.path ?? "(none)",
    format: photo.format ?? "(none)",
  });

  const normalizedFormat = (photo.format || "jpeg").toLowerCase();
  const fallbackMimeType = PHOTO_FORMAT_TO_MIME[normalizedFormat] || "image/jpeg";
  console.log("[cameraPhotoToBlob] format →", normalizedFormat, "mime →", fallbackMimeType);

  if (photo.base64String) {
    try {
      console.log("[cameraPhotoToBlob] Attempting base64 path...");
      const normalizedBase64 = normalizeBase64String(photo.base64String);
      console.log("[cameraPhotoToBlob] Base64 normalized, length:", normalizedBase64.length);
      const blob = base64ToBlob(normalizedBase64, fallbackMimeType);
      console.log("[cameraPhotoToBlob] Base64 → Blob OK, size:", blob.size);

      return {
        blob,
        mimeType: fallbackMimeType,
        extension: mimeToExtension(fallbackMimeType),
        previewUrl: `data:${fallbackMimeType};base64,${normalizedBase64.substring(0, 50)}...`,
      };
    } catch (base64Error) {
      console.error("[cameraPhotoToBlob] Base64 conversion FAILED:", base64Error);
    }
  }

  const sourcePath = photo.webPath || (photo.path ? Capacitor.convertFileSrc(photo.path) : undefined);
  console.log("[cameraPhotoToBlob] Trying fetch path:", sourcePath ?? "(none)");

  if (sourcePath) {
    try {
      const response = await fetch(sourcePath);
      console.log("[cameraPhotoToBlob] fetch status:", response.status, response.statusText);
      if (!response.ok) {
        throw new Error(`Failed to read selected photo (HTTP ${response.status} ${response.statusText})`);
      }

      const fetchedBlob = await response.blob();
      console.log("[cameraPhotoToBlob] fetched blob size:", fetchedBlob.size, "type:", fetchedBlob.type);
      const mimeType = fetchedBlob.type || fallbackMimeType;
      const blob = fetchedBlob.type
        ? fetchedBlob
        : new Blob([await fetchedBlob.arrayBuffer()], { type: mimeType });

      return {
        blob,
        mimeType,
        extension: mimeToExtension(mimeType),
        previewUrl: sourcePath,
      };
    } catch (fetchError) {
      console.error("[cameraPhotoToBlob] fetch path FAILED:", fetchError);
      throw fetchError;
    }
  }

  console.error("[cameraPhotoToBlob] No data source available at all");
  throw new Error("Selected photo data is unavailable (no base64, webPath, or path)");
}

