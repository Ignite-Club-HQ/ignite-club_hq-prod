/**
 * Shared native iOS photo picker logic.
 * Used by profile, club, team, chat, gallery, vault, and other upload flows.
 *
 * NO fallback to HTML file input. If the native picker fails, we retry
 * with increased delays to handle iCloud-optimized photos, then show
 * a user-friendly error asking them to try again.
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

// ──────────────────────────────────────────────────────────────────────
// Permission warm-up
// ──────────────────────────────────────────────────────────────────────
let permissionsReady = false;
let permissionsPromise: Promise<void> | null = null;

/**
 * Ensures photo library permissions are granted before opening the picker.
 * Handles all iOS permission states: prompt, limited, denied, granted.
 *
 * - "granted" / "limited" → ready to pick (limited still allows selection)
 * - "prompt" / "prompt-with-rationale" → request permission
 * - "denied" → throw with actionable message so caller can show a toast
 */
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

      const photoStatus = status.photos;

      // Already granted or limited — both allow photo selection
      if (photoStatus === "granted" || photoStatus === "limited") {
        permissionsReady = true;
        return;
      }

      // Denied — the OS will NOT show the permission dialog again.
      // Throw so callers can show a helpful message.
      if (photoStatus === "denied") {
        throw new Error(
          "Photo access is denied. Please go to Settings → Privacy → Photos and enable access for this app."
        );
      }

      // prompt / prompt-with-rationale — request permission
      if (photoStatus === "prompt" || photoStatus === "prompt-with-rationale") {
        console.log("[nativePhotoPicker] Requesting photo permissions...");
        const result = await Camera.requestPermissions({ permissions: ["photos"] });
        console.log("[nativePhotoPicker] Permission result:", JSON.stringify(result));

        // Small delay to let the OS fully register the grant
        await new Promise((r) => setTimeout(r, 200));

        // Verify the grant
        const verified = await Camera.checkPermissions();
        console.log("[nativePhotoPicker] Post-grant verification:", JSON.stringify(verified));

        if (verified.photos === "denied") {
          throw new Error(
            "Photo access was denied. Please go to Settings → Privacy → Photos and enable access for this app."
          );
        }
      }

      permissionsReady = true;
    } catch (err) {
      // If the error is our own actionable message, re-throw it
      if (err instanceof Error && err.message.includes("Settings")) {
        permissionsReady = false;
        permissionsPromise = null;
        throw err;
      }
      // Non-fatal warm-up error — allow the picker to attempt anyway
      console.warn("[nativePhotoPicker] Permission warm-up failed (non-fatal):", err);
      permissionsReady = true;
    }
  })();

  return permissionsPromise;
}

/**
 * Resets the permission cache so the next pick will re-check.
 * Useful after the user returns from Settings.
 */
export function resetPermissionCache(): void {
  permissionsReady = false;
  permissionsPromise = null;
}

// ──────────────────────────────────────────────────────────────────────
// Photo picking — NO fallback to HTML file input
// ──────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_WIDTH: number | undefined = undefined;

/**
 * Picks a photo using the native iOS camera picker.
 * Uses URI mode for best iCloud compatibility.
 * Does NOT fall back to HTML file input under any circumstances.
 *
 * On failure, throws an error — callers should show a toast asking the user to try again.
 */
export async function pickNativePhoto(options?: {
  quality?: number;
  width?: number;
  height?: number;
}): Promise<NativePhotoResult> {
  const { quality = 80, width, height } = options ?? {};
  const effectiveWidth = width || DEFAULT_MAX_WIDTH;

  // This will throw with an actionable message if permissions are denied
  await ensureCameraPermissions();

  const photoOptions = {
    source: CameraSource.Photos,
    allowEditing: false,
    quality,
    ...(effectiveWidth ? { width: effectiveWidth } : {}),
    ...(height ? { height } : {}),
  };

  // ── Strategy 1: URI mode (best for large/iCloud photos) ──
  try {
    console.log("[nativePhotoPicker] Attempting URI mode");
    const photo = await Camera.getPhoto({
      ...photoOptions,
      resultType: CameraResultType.Uri,
    });

    if (hasCameraPhotoSource(photo)) {
      try {
        const result = await cameraPhotoToBlob(photo);
        console.log("[nativePhotoPicker] URI mode → blob OK, size:", result.blob.size);
        return {
          blob: result.blob,
          mimeType: result.mimeType,
          extension: result.extension,
          previewUrl: result.previewUrl,
        };
      } catch (blobError) {
        console.warn("[nativePhotoPicker] URI mode blob conversion failed:", blobError);
        // Fall through to Base64 strategy below
      }
    }
  } catch (uriPickerError: unknown) {
    if (isCancelledSelectionError(uriPickerError)) throw uriPickerError;
    console.warn("[nativePhotoPicker] URI picker failed:", uriPickerError);
    // Fall through to Base64 strategy below
  }

  // ── Strategy 2: Base64 mode (reliable fallback when URI fetch fails) ──
  try {
    console.log("[nativePhotoPicker] Attempting Base64 mode fallback");
    const photo = await Camera.getPhoto({
      ...photoOptions,
      resultType: CameraResultType.Base64,
    });

    if (!photo.base64String) {
      throw new Error("No base64 data returned from photo picker");
    }

    console.log("[nativePhotoPicker] Base64 mode returned data, length:", photo.base64String.length);
    const result = await cameraPhotoToBlob(photo);
    console.log("[nativePhotoPicker] Base64 mode → blob OK, size:", result.blob.size);
    return {
      blob: result.blob,
      mimeType: result.mimeType,
      extension: result.extension,
      previewUrl: result.previewUrl,
    };
  } catch (base64Error: unknown) {
    if (isCancelledSelectionError(base64Error)) throw base64Error;

    console.error("[nativePhotoPicker] Base64 mode also failed:", base64Error);
    resetPermissionCache();

    const msg = getReadableUploadError(base64Error);
    throw new Error(
      msg || "Could not load the selected photo. Please try again."
    );
  }
}

/** Check if current platform should use native photo picker */
export const shouldUseNativePicker = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
