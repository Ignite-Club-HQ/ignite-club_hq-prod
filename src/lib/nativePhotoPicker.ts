import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { FilePicker, type PickedFile } from "@capawesome/capacitor-file-picker";
import { cameraPhotoToBlob, mimeToExtension } from "@/lib/binaryUtils";
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

const blobFromResponse = async (response: Response, mimeType: string): Promise<Blob> => {
  const fetchedBlob = await response.blob();
  if (fetchedBlob.type && fetchedBlob.type !== mimeType) {
    return fetchedBlob;
  }

  if (fetchedBlob.size === 0) {
    throw new Error("Photo data is empty (0 bytes)");
  }

  if (fetchedBlob.type) {
    return fetchedBlob;
  }

  return new Blob([await fetchedBlob.arrayBuffer()], { type: mimeType });
};

const pickedFileToBlob = async (pickedFile: PickedFile): Promise<NativePhotoResult> => {
  const mimeType = pickedFile.mimeType || "image/jpeg";
  const extension = mimeToExtension(mimeType);

  if (pickedFile.data) {
    const result = await cameraPhotoToBlob({
      base64String: pickedFile.data,
      format: extension,
    });

    return {
      blob: result.blob,
      mimeType: result.mimeType || mimeType,
      extension: result.extension || extension,
      previewUrl: result.previewUrl,
    };
  }

  const sourceCandidates = [
    pickedFile.path ? Capacitor.convertFileSrc(pickedFile.path) : undefined,
    pickedFile.path,
  ].filter((value): value is string => Boolean(value));

  let lastError: unknown;

  for (const sourcePath of [...new Set(sourceCandidates)]) {
    try {
      console.log("[nativePhotoPicker] Reading picked file:", sourcePath.substring(0, 120));
      const response = await fetch(sourcePath, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to read selected photo (HTTP ${response.status} ${response.statusText})`);
      }

      const blob = await blobFromResponse(response, mimeType);
      return {
        blob,
        mimeType: blob.type || mimeType,
        extension: mimeToExtension(blob.type || mimeType),
        previewUrl: URL.createObjectURL(blob),
      };
    } catch (error) {
      lastError = error;
      console.warn("[nativePhotoPicker] Picked file read failed:", getErrorMessage(error));
    }
  }

  throw new Error(
    lastError
      ? `Selected photo data is unavailable (${getErrorMessage(lastError)})`
      : "Selected photo data is unavailable (no readable file path or data)"
  );
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
 * Picks a photo using a reliable native iOS image picker.
 * This avoids the Capacitor Camera photo-library path that can throw
 * "Error loading image" for iCloud-optimized Photos assets on iOS.
 *
 * The options are kept for API compatibility with existing callers.
 */
export async function pickNativePhoto(_options?: NativePhotoPickOptions): Promise<NativePhotoResult> {
  await ensureCameraPermissions();

  let pickerDismissed = false;
  let dismissListener: PluginListenerHandle | null = null;

  try {
    dismissListener = await FilePicker.addListener("pickerDismissed", () => {
      pickerDismissed = true;
    });
  } catch (listenerError) {
    console.warn("[nativePhotoPicker] Could not attach pickerDismissed listener:", listenerError);
  }

  try {
    console.log("[nativePhotoPicker] Opening native FilePicker image picker");
    const result = await FilePicker.pickImages({
      limit: 1,
      ordered: false,
      readData: false,
      skipTranscoding: false,
    });

    const pickedFile = result.files?.[0];
    if (!pickedFile) {
      throw new Error("Picker was cancelled");
    }

    const converted = await pickedFileToBlob(pickedFile);
    console.log("[nativePhotoPicker] Native FilePicker → blob OK, size:", converted.blob.size, "mime:", converted.mimeType);
    return converted;
  } catch (error: unknown) {
    if (pickerDismissed || isCancelledSelectionError(error)) {
      throw new Error("Picker was cancelled");
    }

    console.warn("[nativePhotoPicker] FilePicker path failed, retrying with data read:", error);

    try {
      const fallbackResult = await FilePicker.pickImages({
        limit: 1,
        ordered: false,
        readData: true,
        skipTranscoding: false,
      });

      const pickedFile = fallbackResult.files?.[0];
      if (!pickedFile) {
        throw new Error("Picker was cancelled");
      }

      const converted = await pickedFileToBlob(pickedFile);
      console.log("[nativePhotoPicker] FilePicker data read → blob OK, size:", converted.blob.size, "mime:", converted.mimeType);
      return converted;
    } catch (fallbackError: unknown) {
      if (pickerDismissed || isCancelledSelectionError(fallbackError)) {
        throw new Error("Picker was cancelled");
      }

      console.error("[nativePhotoPicker] Native FilePicker failed:", fallbackError);
      await wait(50);
      throw new Error(
        getReadableUploadError(fallbackError) ||
          getReadableUploadError(error) ||
          "Could not load the selected photo. Please try again."
      );
    }
  } finally {
    try {
      await dismissListener?.remove();
    } catch (removeError) {
      console.warn("[nativePhotoPicker] Failed to remove picker listener:", removeError);
    }
  }
}

/** Check if current platform should use native photo picker */
export const shouldUseNativePicker = () => isNativeIOS();
