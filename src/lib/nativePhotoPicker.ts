/**
 * Shared native iOS photo picker logic with fallback strategy.
 * Used by profile, club, team, and other upload flows.
 *
 * The Capacitor Camera plugin has a persistent bug (#1807) where
 * iCloud-optimized photos throw "error loading image". Rather than
 * retrying Camera.getPhoto() (which reopens the picker — bad UX),
 * callers should fall back to the HTML file input when this fails.
 */
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { cameraPhotoToBlob, hasCameraPhotoSource } from "@/lib/binaryUtils";
import { getReadableUploadError, isCancelledSelectionError } from "@/lib/uploadErrorUtils";

export interface NativePhotoResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  previewUrl: string;
}

/** Indicates the native picker failed but the user DID try to pick a photo.
 *  Callers should fall back to HTML file input. */
export class NativePickerLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativePickerLoadError";
  }
}

const isLoadingError = (err: unknown) => {
  const msg = getReadableUploadError(err).toLowerCase();
  return msg.includes("error loading image") || msg.includes("loading image");
};

// ──────────────────────────────────────────────────────────────────────
// Permission warm-up
// ──────────────────────────────────────────────────────────────────────
let permissionsReady = false;
let permissionsPromise: Promise<void> | null = null;

export async function ensureCameraPermissions(): Promise<void> {
  if (permissionsReady) return;
  if (permissionsPromise) return permissionsPromise;

  if (!Capacitor.isNativePlatform()) {
    permissionsReady = true;
    return;
  }

  permissionsPromise = (async () => {
    try {
      const status = await Camera.checkPermissions();
      console.log("[nativePhotoPicker] Current permissions:", JSON.stringify(status));

      if (status.photos === "prompt" || status.photos === "prompt-with-rationale") {
        console.log("[nativePhotoPicker] Requesting photo permissions...");
        const result = await Camera.requestPermissions({ permissions: ["photos"] });
        console.log("[nativePhotoPicker] Permission result:", JSON.stringify(result));
        await new Promise((r) => setTimeout(r, 150));
        const verified = await Camera.checkPermissions();
        console.log("[nativePhotoPicker] Post-grant verification:", JSON.stringify(verified));
      }

      permissionsReady = true;
    } catch (err) {
      console.warn("[nativePhotoPicker] Permission warm-up failed (non-fatal):", err);
      permissionsReady = true;
    }
  })();

  return permissionsPromise;
}

// ──────────────────────────────────────────────────────────────────────
// Photo picking
// ──────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_WIDTH = 2048;

/**
 * Picks a photo using the native iOS camera picker.
 * Does NOT retry Camera.getPhoto() on failure (that would reopen the picker).
 * 
 * Throws NativePickerLoadError on "error loading image" — callers should
 * catch this specifically and fall back to HTML file input.
 */
export async function pickNativePhoto(options?: {
  quality?: number;
  width?: number;
  height?: number;
}): Promise<NativePhotoResult> {
  const { quality = 80, width, height } = options ?? {};
  const effectiveWidth = width || DEFAULT_MAX_WIDTH;

  const photoOptions = {
    source: CameraSource.Photos,
    allowEditing: false,
    quality,
    width: effectiveWidth,
    ...(height ? { height } : {}),
  };

  let photo: Awaited<ReturnType<typeof Camera.getPhoto>>;

  // Single attempt with URI mode (best iCloud compatibility).
  // If this fails, we throw immediately — no retries that reopen the picker.
  try {
    console.log("[nativePhotoPicker] Attempting URI mode");
    photo = await Camera.getPhoto({
      ...photoOptions,
      resultType: CameraResultType.Uri,
    });
  } catch (uriError: unknown) {
    if (isCancelledSelectionError(uriError)) throw uriError;

    console.warn("[nativePhotoPicker] URI mode failed:", uriError);

    // Try Base64 as a single fallback (doesn't reopen picker on some iOS versions
    // if the photo was already selected)
    try {
      console.log("[nativePhotoPicker] Trying Base64 fallback");
      photo = await Camera.getPhoto({
        ...photoOptions,
        resultType: CameraResultType.Base64,
      });
    } catch (base64Error: unknown) {
      if (isCancelledSelectionError(base64Error)) throw base64Error;

      // Throw a specific error so callers can fall back to HTML file input
      const msg = getReadableUploadError(uriError);
      if (isLoadingError(uriError)) {
        throw new NativePickerLoadError(
          msg || "Error loading image — please try selecting from files"
        );
      }
      throw uriError;
    }
  }

  if (!hasCameraPhotoSource(photo)) {
    throw new Error("No photo selected (missing base64String/webPath/path)");
  }

  const result = await cameraPhotoToBlob(photo);
  return {
    blob: result.blob,
    mimeType: result.mimeType,
    extension: result.extension,
    previewUrl: result.previewUrl,
  };
}

/** Check if current platform should use native photo picker */
export const shouldUseNativePicker = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
