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

  let photo: Awaited<ReturnType<typeof Camera.getPhoto>>;

  try {
    photo = await Camera.getPhoto({
      ...photoOptions,
      resultType: CameraResultType.Base64,
    });
  } catch (firstAttemptError: unknown) {
    if (isCancelledSelectionError(firstAttemptError)) {
      throw firstAttemptError;
    }

    if (isLoadingError(firstAttemptError)) {
      // Base64 failed (iCloud, large HEIC, etc.) — try URI mode
      console.warn("[nativePhotoPicker] Base64 failed, falling back to URI:", firstAttemptError);
      photo = await Camera.getPhoto({
        ...photoOptions,
        resultType: CameraResultType.Uri,
      });
    } else {
      // Permission dialog / gesture-chain break — retry once
      console.warn("[nativePhotoPicker] getPhoto attempt 1 failed, retrying:", firstAttemptError);
      try {
        photo = await Camera.getPhoto({
          ...photoOptions,
          resultType: CameraResultType.Base64,
        });
      } catch (secondAttemptError: unknown) {
        if (!isCancelledSelectionError(secondAttemptError) && isLoadingError(secondAttemptError)) {
          console.warn("[nativePhotoPicker] Base64 retry failed, falling back to URI:", secondAttemptError);
          photo = await Camera.getPhoto({
            ...photoOptions,
            resultType: CameraResultType.Uri,
          });
        } else {
          throw secondAttemptError;
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
