/**
 * Shared native iOS photo picker logic with retry/fallback strategy.
 * Used by profile, club, team, and other upload flows.
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

/**
 * Picks a photo using the native iOS camera picker with a resilient
 * Base64 → URI fallback strategy. Returns a blob ready for upload.
 * 
 * IMPORTANT: Call this directly from the user tap handler — do NOT
 * set any React state before calling, as that breaks the iOS gesture chain.
 */
export async function pickNativePhoto(options?: {
  quality?: number;
  width?: number;
  height?: number;
}): Promise<NativePhotoResult> {
  const { quality = 80, width, height } = options ?? {};

  const photoOptions = {
    source: CameraSource.Photos,
    allowEditing: false,
    quality,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };

  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /**
   * Attempt Camera.getPhoto with the given resultType, retrying on
   * "error loading image" (iCloud / HEIC processing) with increasing delays.
   * Returns the photo or throws the last error.
   */
  const attemptGetPhoto = async (
    resultType: CameraResultType,
    maxRetries: number,
    baseDelayMs: number,
    label: string,
  ): Promise<Awaited<ReturnType<typeof Camera.getPhoto>>> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = baseDelayMs * attempt;
        console.log(`[nativePhotoPicker] ${label} retry ${attempt}/${maxRetries} in ${delay}ms`);
        await wait(delay);
      }
      try {
        return await Camera.getPhoto({ ...photoOptions, resultType });
      } catch (err: unknown) {
        if (isCancelledSelectionError(err)) throw err;
        console.warn(`[nativePhotoPicker] ${label} attempt ${attempt + 1} failed:`, err);
        lastError = err;
        if (!isLoadingError(err) && attempt === 0) {
          // Non-loading error on first attempt (e.g. permission) — retry once more then bail
          continue;
        }
        if (!isLoadingError(err)) throw err;
      }
    }
    throw lastError;
  };

  let photo: Awaited<ReturnType<typeof Camera.getPhoto>>;

  try {
    // Primary: Base64 with up to 3 retries (delays: 800, 1600, 2400ms)
    photo = await attemptGetPhoto(CameraResultType.Base64, 3, 800, "Base64");
  } catch (base64Error: unknown) {
    if (isCancelledSelectionError(base64Error)) throw base64Error;

    // Fallback: URI mode with up to 3 retries (delays: 1000, 2000, 3000ms)
    console.warn("[nativePhotoPicker] All Base64 attempts failed, falling back to URI mode");
    try {
      photo = await attemptGetPhoto(CameraResultType.Uri, 3, 1000, "URI");
    } catch (uriError: unknown) {
      if (isCancelledSelectionError(uriError)) throw uriError;
      // Throw the most informative error
      throw base64Error;
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
