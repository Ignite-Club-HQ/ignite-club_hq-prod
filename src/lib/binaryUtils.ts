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

export interface CameraPhotoLike {
  base64String?: string | null;
  webPath?: string;
  path?: string;
  format?: string | null;
}

const NATIVE_READ_RETRY_ATTEMPTS = 2;
const NATIVE_READ_RETRY_DELAY_MS = 180;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
};

const getPhotoSourceCandidates = (photo: CameraPhotoLike): string[] => {
  const candidates = [
    photo.webPath,
    photo.path ? Capacitor.convertFileSrc(photo.path) : undefined,
    photo.path,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return [...new Set(candidates)];
};

const readBlobFromResponse = async (
  response: Response,
  fallbackMimeType: string,
): Promise<{ blob: Blob; mimeType: string }> => {
  const fetchedBlob = await response.blob();
  const mimeType = fetchedBlob.type || fallbackMimeType;

  if (fetchedBlob.type) {
    return { blob: fetchedBlob, mimeType };
  }

  return {
    blob: new Blob([await fetchedBlob.arrayBuffer()], { type: mimeType }),
    mimeType,
  };
};

const fetchPhotoBlobFromSource = async (
  sourcePath: string,
  fallbackMimeType: string,
): Promise<{ blob: Blob; mimeType: string }> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= NATIVE_READ_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(sourcePath, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to read selected photo (HTTP ${response.status} ${response.statusText})`);
      }

      return await readBlobFromResponse(response, fallbackMimeType);
    } catch (error) {
      lastError = error;
      if (attempt < NATIVE_READ_RETRY_ATTEMPTS) {
        await wait(NATIVE_READ_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
    }
  }

  throw new Error(getErrorMessage(lastError));
};

export function hasCameraPhotoSource(photo: CameraPhotoLike): boolean {
  return Boolean(photo.base64String || photo.webPath || photo.path);
}

export function describeCameraPhotoSource(photo: CameraPhotoLike): string {
  return `base64=${Boolean(photo.base64String)} webPath=${Boolean(photo.webPath)} path=${Boolean(photo.path)}`;
}

export async function cameraPhotoToBlob(photo: CameraPhotoLike): Promise<{
  blob: Blob;
  mimeType: string;
  extension: string;
  previewUrl: string;
}> {
  const normalizedFormat = (photo.format || "jpeg").toLowerCase();
  const fallbackMimeType = PHOTO_FORMAT_TO_MIME[normalizedFormat] || "image/jpeg";
  let lastError: unknown;

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
    } catch (error) {
      lastError = error;
    }
  }

  const sourceCandidates = getPhotoSourceCandidates(photo);

  for (const sourcePath of sourceCandidates) {
    try {
      const { blob, mimeType } = await fetchPhotoBlobFromSource(sourcePath, fallbackMimeType);

      return {
        blob,
        mimeType,
        extension: mimeToExtension(mimeType),
        previewUrl: sourcePath,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw new Error(`Selected photo data is unavailable (${getErrorMessage(lastError)})`);
  }

  throw new Error("Selected photo data is unavailable (no base64, webPath, or path)");
}


