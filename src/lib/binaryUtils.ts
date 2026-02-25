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
