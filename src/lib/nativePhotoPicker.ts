import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { cameraPhotoToBlob, hasCameraPhotoSource, describeCameraPhotoSource } from "@/lib/binaryUtils";
import { getReadableUploadError, isCancelledSelectionError } from "@/lib/uploadErrorUtils";

export interface NativePhotoResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  previewUrl: string;
}

const isNativeIOS = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return getReadableUploadError(error) || "unknown error";
};

export async function ensureCameraPermissions(): Promise<void> {
  if (!isNativeIOS()) return;
  return;
}

export function resetPermissionCache(): void {
  return;
}

export interface NativePhotoPickOptions {
  quality?: number;
  width?: number;
  height?: number;
}

const buildBaseOptions = (options?: NativePhotoPickOptions) => ({
  source: CameraSource.Photos,
  quality: options?.quality ?? 90,
  correctOrientation: true,
  presentationStyle: "fullscreen" as const,
  ...(typeof options?.width === "number" ? { width: options.width } : {}),
  ...(typeof options?.height === "number" ? { height: options.height } : {}),
});

const isIOSPhotoLoadFailure = (error: unknown) => {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("error loading image") ||
    message.includes("loading image") ||
    message.includes("selected photo data is unavailable")
  );
};

const getNativePhotoLoadError = (error: unknown) => {
  if (isIOSPhotoLoadFailure(error)) {
    return "That photo isn't fully available on this iPhone yet. Open it once in Photos or choose another image and try again.";
  }

  return getReadableUploadError(error) || "Could not load the selected photo. Please try again.";
};

/**
 * Picks a photo using the Capacitor Camera plugin on iOS.
 * Uses Base64 result type only because URI fallback re-opens the picker and
 * tends to fail the same way for iCloud-optimized assets.
 */
export async function pickNativePhoto(options?: NativePhotoPickOptions): Promise<NativePhotoResult> {
  await ensureCameraPermissions();

  const baseOptions = buildBaseOptions(options);

  try {
    console.log("[nativePhotoPicker] Trying Camera plugin with Base64 result type");
    const photo = await Camera.getPhoto({
      ...baseOptions,
      resultType: CameraResultType.Base64,
    });

    if (!hasCameraPhotoSource(photo)) {
      console.warn("[nativePhotoPicker] Base64 photo has no source:", describeCameraPhotoSource(photo));
      throw new Error("No photo data returned from Camera plugin (Base64)");
    }

    const result = await cameraPhotoToBlob(photo);
    console.log("[nativePhotoPicker] Base64 strategy → blob OK, size:", result.blob.size, "mime:", result.mimeType);
    return result;
  } catch (error: unknown) {
    if (isCancelledSelectionError(error)) {
      throw new Error("Picker was cancelled");
    }
    console.error("[nativePhotoPicker] Base64 strategy failed:", getErrorMessage(error));
    await wait(50);
    throw new Error(getNativePhotoLoadError(error));
  }
}

/** Check if current platform should use native photo picker */
export const shouldUseNativePicker = () => isNativeIOS();
