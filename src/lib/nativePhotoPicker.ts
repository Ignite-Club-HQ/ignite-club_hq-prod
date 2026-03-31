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

/**
 * Picks a photo using the Capacitor Camera plugin on iOS.
 * Uses Base64 result type first (most reliable for iCloud-optimized photos),
 * falls back to URI if Base64 fails.
 */
export async function pickNativePhoto(options?: NativePhotoPickOptions): Promise<NativePhotoResult> {
  await ensureCameraPermissions();

  const baseOptions = {
    source: CameraSource.Photos,
    quality: options?.quality ?? 90,
    width: options?.width ?? 1920,
    height: options?.height ?? 1920,
    correctOrientation: true,
    presentationStyle: "fullscreen" as const,
  };

  // Strategy 1: Base64 mode — most reliable on iOS, avoids temp file issues
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
  } catch (base64Error: unknown) {
    if (isCancelledSelectionError(base64Error)) {
      throw new Error("Picker was cancelled");
    }
    console.warn("[nativePhotoPicker] Base64 strategy failed:", getErrorMessage(base64Error));
  }

  // Strategy 2: URI mode — fallback
  try {
    console.log("[nativePhotoPicker] Trying Camera plugin with URI result type");
    const photo = await Camera.getPhoto({
      ...baseOptions,
      resultType: CameraResultType.Uri,
    });

    if (!hasCameraPhotoSource(photo)) {
      console.warn("[nativePhotoPicker] URI photo has no source:", describeCameraPhotoSource(photo));
      throw new Error("No photo data returned from Camera plugin (URI)");
    }

    const result = await cameraPhotoToBlob(photo);
    console.log("[nativePhotoPicker] URI strategy → blob OK, size:", result.blob.size, "mime:", result.mimeType);
    return result;
  } catch (uriError: unknown) {
    if (isCancelledSelectionError(uriError)) {
      throw new Error("Picker was cancelled");
    }

    console.error("[nativePhotoPicker] Both strategies failed. URI error:", getErrorMessage(uriError));
    await wait(50);
    throw new Error(
      getReadableUploadError(uriError) ||
        "Could not load the selected photo. Please try again."
    );
  }
}

/** Check if current platform should use native photo picker */
export const shouldUseNativePicker = () => isNativeIOS();
