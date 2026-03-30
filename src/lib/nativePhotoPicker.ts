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

  let photo: Awaited<ReturnType<typeof Camera.getPhoto>>;

  // Use URI mode — best compatibility with iCloud-optimized photos.
  try {
    console.log("[nativePhotoPicker] Attempting URI mode");
    photo = await Camera.getPhoto({
      ...photoOptions,
      resultType: CameraResultType.Uri,
    });
  } catch (uriError: unknown) {
    if (isCancelledSelectionError(uriError)) throw uriError;

    console.warn("[nativePhotoPicker] URI mode failed:", uriError);

    // Reset permission cache in case the failure was permission-related
    resetPermissionCache();

    // Re-throw with a user-friendly message — NO fallback to file input
    const msg = getReadableUploadError(uriError);
    throw new Error(
      msg || "Could not load the selected photo. Please try again."
    );
  }

  if (!hasCameraPhotoSource(photo)) {
    throw new Error("No photo selected (missing base64String/webPath/path)");
  }

  // Convert the photo to a blob — binaryUtils handles retries internally
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
