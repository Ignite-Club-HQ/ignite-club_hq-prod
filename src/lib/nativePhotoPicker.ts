/**
 * Shared native iOS photo picker logic with retry/fallback strategy.
 * Used by profile, club, team, and other upload flows.
 *
 * ROOT CAUSE of past "error loading image" failures:
 * 1. Capacitor Camera plugin doesn't wait for iCloud downloads when
 *    "Optimize iPhone Storage" is enabled (known plugin bug #1807).
 * 2. The first Camera.getPhoto() call triggers the iOS permission dialog,
 *    and the plugin throws instead of waiting for the grant.
 *
 * STRATEGY:
 * - Pre-request permissions (warm-up) on app startup so the permission
 *   dialog never overlaps with photo selection.
 * - Use URI mode as PRIMARY (better iCloud support than Base64).
 * - Always pass a width constraint (forces iOS to deliver a locally-
 *   available rendition instead of the full-res iCloud original).
 * - Fall back to Base64 mode only if URI fails.
 */
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { cameraPhotoToBlob, hasCameraPhotoSource } from "@/lib/binaryUtils";
import { getReadableUploadError, isCancelledSelectionError } from "@/lib/uploadErrorUtils";
import { emitIOSNavGuard } from "@/lib/iosLayoutStability";

export interface NativePhotoResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  previewUrl: string;
}

const isLoadingError = (err: unknown) => {
  const msg = getReadableUploadError(err).toLowerCase();
  return msg.includes("error loading image") || msg.includes("loading image");
};

// ──────────────────────────────────────────────────────────────────────
// Permission warm-up — call once at app startup on native iOS.
// Ensures the iOS permission dialog is shown (and granted) before any
// Camera.getPhoto() call, preventing the "error loading image" loop.
// ──────────────────────────────────────────────────────────────────────
let permissionsReady = false;
let permissionsPromise: Promise<void> | null = null;

/**
 * Ensures Camera/Photos permissions are granted.
 * Safe to call multiple times — only the first call does actual work.
 * Call this early (e.g. after login) so the permission dialog appears
 * before the user taps an upload button.
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

      if (status.photos === "prompt" || status.photos === "prompt-with-rationale") {
        console.log("[nativePhotoPicker] Requesting photo permissions...");
        const result = await Camera.requestPermissions({ permissions: ["photos"] });
        console.log("[nativePhotoPicker] Permission result:", JSON.stringify(result));

        // Brief delay for iOS to register the permission grant
        await new Promise((r) => setTimeout(r, 150));

        // Re-verify the permission actually took effect
        const verified = await Camera.checkPermissions();
        console.log("[nativePhotoPicker] Post-grant verification:", JSON.stringify(verified));
      }

      permissionsReady = true;
    } catch (err) {
      // Don't block on permission errors — getPhoto will re-prompt if needed
      console.warn("[nativePhotoPicker] Permission warm-up failed (non-fatal):", err);
      permissionsReady = true;
    }
  })();

  return permissionsPromise;
}

// ──────────────────────────────────────────────────────────────────────
// Photo picking
// ──────────────────────────────────────────────────────────────────────

/** Default max width to request — forces iOS to deliver a local rendition
 *  instead of trying to download the full-res iCloud original. */
const DEFAULT_MAX_WIDTH = 2048;

/**
 * Picks a photo using the native iOS camera picker with a resilient
 * URI → Base64 fallback strategy. Returns a blob ready for upload.
 *
 * IMPORTANT: Call this directly from the user tap handler — do NOT
 * set any React state before calling, as that breaks the iOS gesture chain.
 */
export async function pickNativePhoto(options?: {
  quality?: number;
  width?: number;
  height?: number;
}): Promise<NativePhotoResult> {
  // Ensure permissions are granted before opening the picker
  await ensureCameraPermissions();

  const { quality = 80, width, height } = options ?? {};

  // Always constrain width to avoid full-res iCloud downloads
  const effectiveWidth = width || DEFAULT_MAX_WIDTH;

  const photoOptions = {
    source: CameraSource.Photos,
    allowEditing: false,
    quality,
    width: effectiveWidth,
    ...(height ? { height } : {}),
  };

  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  let photo: Awaited<ReturnType<typeof Camera.getPhoto>>;

  // ── Strategy: URI first (better iCloud support), then Base64 fallback ──
  try {
    // Primary attempt: URI mode — iOS can serve a local file reference
    // for iCloud photos more reliably than loading into memory as Base64.
    console.log("[nativePhotoPicker] Attempting URI mode (primary)");
    photo = await Camera.getPhoto({
      ...photoOptions,
      resultType: CameraResultType.Uri,
    });
  } catch (uriError: unknown) {
    if (isCancelledSelectionError(uriError)) throw uriError;

    console.warn("[nativePhotoPicker] URI mode failed:", uriError);

    if (isLoadingError(uriError)) {
      // iCloud photo not ready — wait and retry URI once
      console.log("[nativePhotoPicker] iCloud loading error, waiting 500ms before retry...");
      await wait(500);

      try {
        photo = await Camera.getPhoto({
          ...photoOptions,
          resultType: CameraResultType.Uri,
        });
      } catch (uriRetryError: unknown) {
        if (isCancelledSelectionError(uriRetryError)) throw uriRetryError;

        // Last resort: try Base64 (some edge cases handle this better)
        console.warn("[nativePhotoPicker] URI retry failed, trying Base64 fallback");
        try {
          photo = await Camera.getPhoto({
            ...photoOptions,
            resultType: CameraResultType.Base64,
          });
        } catch (base64Error: unknown) {
          if (isCancelledSelectionError(base64Error)) throw base64Error;
          // Throw the original URI error as it's more informative
          throw uriError;
        }
      }
    } else {
      // Non-loading error (permission, gesture chain break) — retry once
      console.warn("[nativePhotoPicker] Non-loading error, retrying once...");
      try {
        photo = await Camera.getPhoto({
          ...photoOptions,
          resultType: CameraResultType.Uri,
        });
      } catch (retryError: unknown) {
        if (isCancelledSelectionError(retryError)) throw retryError;

        // Try Base64 as last resort
        try {
          photo = await Camera.getPhoto({
            ...photoOptions,
            resultType: CameraResultType.Base64,
          });
        } catch (base64Error: unknown) {
          if (isCancelledSelectionError(base64Error)) throw base64Error;
          throw retryError;
        }
      }
    }
  }

  // Stabilize BottomNav after picker closes
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  if (isNativeIOS) {
    emitIOSNavGuard(900, { forceFloor: true });
    setTimeout(() => emitIOSNavGuard(1500, { forceFloor: true }), 400);
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
