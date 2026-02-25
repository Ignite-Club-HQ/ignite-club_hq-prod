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
  format?: string | null;
}

export async function cameraPhotoToBlob(photo: CameraPhotoLike): Promise<{
  blob: Blob;
  mimeType: string;
  extension: string;
  previewUrl: string;
}> {
  const normalizedFormat = (photo.format || "jpeg").toLowerCase();
  const fallbackMimeType = PHOTO_FORMAT_TO_MIME[normalizedFormat] || "image/jpeg";

  if (photo.base64String) {
    try {
      const normalizedBase64 = normalizeBase64String(photo.base64String);
      const blob = base64ToBlob(normalizedBase64, fallbackMimeType);

      return {
        blob,
        mimeType: fallbackMimeType,
        extension: mimeToExtension(fallbackMimeType),
        previewUrl: `data:${fallbackMimeType};base64,${normalizedBase64}`,
      };
    } catch (base64Error) {
      console.warn("[binaryUtils] Base64 conversion failed, trying webPath fallback", base64Error);
    }
  }

  if (photo.webPath) {
    const response = await fetch(photo.webPath);
    if (!response.ok) {
      throw new Error(`Failed to read selected photo (${response.status})`);
    }

    const fetchedBlob = await response.blob();
    const mimeType = fetchedBlob.type || fallbackMimeType;
    const blob = fetchedBlob.type
      ? fetchedBlob
      : new Blob([await fetchedBlob.arrayBuffer()], { type: mimeType });

    return {
      blob,
      mimeType,
      extension: mimeToExtension(mimeType),
      previewUrl: photo.webPath,
    };
  }

  throw new Error("Selected photo data is unavailable");
}

