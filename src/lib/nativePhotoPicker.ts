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
  return [
    "error loading image",
    "loading image",
    "cannot select that photo",
    "can't select that photo",
    "cannot select this photo",
    "can't select this photo",
    "could not load",
    "unable to load",
    "cannot load",
    "photo data is unavailable",
    "selected photo data is unavailable",
  ].some((pattern) => msg.includes(pattern));
};

const isSourceUnavailableError = (err: unknown) => {
  const msg = getReadableUploadError(err).toLowerCase();
  return isLoadingError(err) || msg.includes("photo data is unavailable") || msg.includes("asset unavailable");
};

let forceWebPickerForSession = false;

export const disableNativePickerForSession = () => {
  forceWebPickerForSession = true;
};

export const openFileInputPicker = (input: HTMLInputElement | null | undefined): boolean => {
  if (!input) return false;

  try {
    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof pickerInput.showPicker === "function") {
      pickerInput.showPicker();
      return true;
    }
  } catch (error) {
    console.warn("[nativePhotoPicker] showPicker failed:", error);
  }

  try {
    input.click();
    return true;
  } catch (error) {
    console.warn("[nativePhotoPicker] input.click() failed:", error);
    return false;
  }
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

const DEFAULT_MAX_WIDTH: number | undefined = undefined;

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

  await ensureCameraPermissions();

  const photoOptions = {
    source: CameraSource.Photos,
    allowEditing: false,
    quality,
    ...(effectiveWidth ? { width: effectiveWidth } : {}),
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
      const msg = getReadableUploadError(base64Error) || getReadableUploadError(uriError);
      if (isLoadingError(uriError) || isLoadingError(base64Error)) {
        disableNativePickerForSession();
        throw new NativePickerLoadError(
          msg || "Error loading image — please try selecting from files"
        );
      }
      throw base64Error;
    }
  }

  if (!hasCameraPhotoSource(photo)) {
    throw new Error("No photo selected (missing base64String/webPath/path)");
  }

  let result: Awaited<ReturnType<typeof cameraPhotoToBlob>>;

  try {
    result = await cameraPhotoToBlob(photo);
  } catch (blobError: unknown) {
    if (isSourceUnavailableError(blobError)) {
      disableNativePickerForSession();
      throw new NativePickerLoadError(
        getReadableUploadError(blobError) || "Error loading image — please try selecting from files"
      );
    }
    throw blobError;
  }

  return {
    blob: result.blob,
    mimeType: result.mimeType,
    extension: result.extension,
    previewUrl: result.previewUrl,
  };
}

/** Check if current platform should use native photo picker */
export const shouldUseNativePicker = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios" && !forceWebPickerForSession;
