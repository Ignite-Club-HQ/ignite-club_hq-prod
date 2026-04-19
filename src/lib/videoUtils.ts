/**
 * Video upload helpers: validation, metadata, and type detection.
 *
 * NOTE: True client-side video transcoding/compression in the browser
 * requires WebAssembly tools like ffmpeg.wasm (~25MB) which would bloat
 * the bundle significantly. Instead we:
 *   1. Enforce strict size + duration caps to keep storage cost predictable
 *   2. Let the device's native camera/share-sheet pick a compressed clip
 *      (modern phones already compress recorded video heavily)
 *   3. Offer guidance to the user when limits are exceeded
 */

export const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_VIDEO_DURATION_SECONDS = 30;

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v", ".qt"];
const VIDEO_MIME_PREFIX = "video/";

export interface VideoMetadata {
  durationSeconds: number;
  width: number;
  height: number;
}

export function isVideoFile(file: File | { type?: string; name?: string }): boolean {
  if (file.type?.startsWith(VIDEO_MIME_PREFIX)) return true;
  const name = (file.name || "").toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  // Strip query string before extension test
  const cleaned = url.split("?")[0].toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => cleaned.endsWith(ext));
}

export function videoMimeToExtension(mime: string): string {
  const lower = (mime || "").toLowerCase();
  if (lower.includes("quicktime") || lower.includes("mov")) return "mov";
  if (lower.includes("webm")) return "webm";
  if (lower.includes("m4v")) return "m4v";
  return "mp4";
}

/**
 * Reads video metadata (duration, dimensions) by loading it into a
 * hidden <video> element. Resolves with null on failure.
 */
export function probeVideo(file: File | Blob): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8000);

    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const meta: VideoMetadata = {
        durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      cleanup();
      resolve(meta);
    };

    video.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve(null);
    };

    video.src = url;
  });
}

export interface VideoValidationResult {
  ok: boolean;
  reason?: string;
  metadata?: VideoMetadata;
}

export async function validateVideo(file: File): Promise<VideoValidationResult> {
  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    return { ok: false, reason: `Video must be smaller than ${Math.round(MAX_VIDEO_SIZE_BYTES / (1024 * 1024))} MB` };
  }
  const meta = await probeVideo(file);
  if (!meta) {
    return { ok: false, reason: "Couldn't read video — try a different file" };
  }
  if (meta.durationSeconds > MAX_VIDEO_DURATION_SECONDS + 0.5) {
    return {
      ok: false,
      reason: `Video must be ${MAX_VIDEO_DURATION_SECONDS} seconds or less`,
      metadata: meta,
    };
  }
  return { ok: true, metadata: meta };
}
