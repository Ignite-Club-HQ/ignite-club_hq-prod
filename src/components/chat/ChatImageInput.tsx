import { useState, useRef, useEffect } from "react";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";

import { compressImage as compressImageFile } from "@/lib/imageCompression";
import { mimeToExtension } from "@/lib/binaryUtils";
import { getReadableUploadError, isCancelledSelectionError } from "@/lib/uploadErrorUtils";
import { pickNativePhoto, shouldUseNativePicker } from "@/lib/nativePhotoPicker";
import {
  emitIOSNavGuard as dispatchIOSNavGuard,
} from "@/lib/iosLayoutStability";

interface ChatImageInputProps {
  onImageUploaded: (imageUrl: string | null) => void;
  imageUrl: string | null;
  disabled?: boolean;
  clubId?: string;
  teamId?: string;
}

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const IOS_SAFE_COMPRESSION_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function ChatImageInput({ onImageUploaded, imageUrl, disabled, clubId, teamId }: ChatImageInputProps) {
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hadAttachmentRef = useRef(false);
  const navGuardRetryTimeoutRef = useRef<number | null>(null);
  const platform = Capacitor.getPlatform();
  const isNativeIOS = Capacitor.isNativePlatform() && platform === "ios";
  const isIOSEnvironment =
    isNativeIOS ||
    (typeof navigator !== "undefined" &&
      (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)));
  const shouldStabilizeIOSLayout = isIOSEnvironment;

  const dismissIOSKeyboardAccessory = () => {
    if (!isNativeIOS) return;
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const emitIOSNavGuard = (durationMs = 900, options?: { forceFloor?: boolean }) => {
    if (!shouldStabilizeIOSLayout) return;
    dispatchIOSNavGuard(durationMs, options);
  };

  const clearNavGuardRetryTimeout = () => {
    if (typeof window === "undefined") return;
    if (navGuardRetryTimeoutRef.current !== null) {
      window.clearTimeout(navGuardRetryTimeoutRef.current);
      navGuardRetryTimeoutRef.current = null;
    }
  };

  const restoreNativeLayout = () => {
    if (!shouldStabilizeIOSLayout || typeof window === "undefined") return;

    // Guard nav interactions while iOS settles viewport after picker dismissal.
    // Use forceFloor to immediately reset the inset — the permission prompt can
    // leave safe-area inflated for up to ~3s on first-run flows.
    emitIOSNavGuard(900, { forceFloor: true });
    clearNavGuardRetryTimeout();

    // Second guard at 320ms catches immediate permission-dismiss animation
    navGuardRetryTimeoutRef.current = window.setTimeout(() => {
      emitIOSNavGuard(1500, { forceFloor: true });

      // Third guard at ~1.5s catches the long tail of first-run permission flows
      navGuardRetryTimeoutRef.current = window.setTimeout(() => {
        emitIOSNavGuard(1800, { forceFloor: true });
        navGuardRetryTimeoutRef.current = null;
      }, 1200);
    }, 320);
  };

  const uploadBlob = async (blob: Blob, options?: { skipCompression?: boolean }) => {
    const { skipCompression = false } = options ?? {};

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const originalMimeType = blob.type || "image/jpeg";
    let fileToUpload: Blob | File = blob;
    let contentType = originalMimeType;

    if (!skipCompression) {
      const sourceFile = blob instanceof File
        ? blob
        : new File([blob], `photo.${mimeToExtension(originalMimeType)}`, { type: originalMimeType });

      // Compression can fail for some iOS-native formats or webview edge-cases, so fail open.
      try {
        const { file: compressedFile } = await compressImageFile(sourceFile);
        fileToUpload = compressedFile;
        contentType = compressedFile.type || originalMimeType || "image/jpeg";
      } catch (compressionError) {
        console.warn("[ChatImageInput] Compression failed, uploading original file:", compressionError);
        fileToUpload = sourceFile;
        contentType = sourceFile.type || originalMimeType || "image/jpeg";
      }
    }

    const extension = mimeToExtension(contentType);

    const timestamp = Date.now();
    let fileName: string;
    if (teamId && clubId) {
      fileName = `clubs/${clubId}/teams/${teamId}/${user.id}/${timestamp}.${extension}`;
    } else if (clubId) {
      fileName = `clubs/${clubId}/${user.id}/${timestamp}.${extension}`;
    } else {
      fileName = `general/${user.id}/${timestamp}.${extension}`;
    }

    const { error: uploadError } = await supabase.storage
      .from("chat-attachments")
      .upload(fileName, fileToUpload, { contentType, upsert: false });

    if (uploadError) throw new Error(uploadError.message || "Failed to upload image");

    const { data } = supabase.storage.from("chat-attachments").getPublicUrl(fileName);
    return data.publicUrl;
  };

  const handleNativePhotoPick = async () => {
    // CRITICAL: Do NOT set state or blur before pickNativePhoto — doing so
    // triggers a re-render / breaks the gesture chain and iOS rejects the picker.
    console.log("[ChatImageInput] handleNativePhotoPick START");
    let stablePreviewUrl: string | null = null;

    try {
      let result: Awaited<ReturnType<typeof pickNativePhoto>>;

      try {
        // Use shared native picker with resilient Base64 → URI fallback
        result = await pickNativePhoto({ quality: 80 });
        console.log("[ChatImageInput] pickNativePhoto OK, blob size:", result.blob.size, "mime:", result.mimeType);
      } catch (pickerError: unknown) {
        if (isCancelledSelectionError(pickerError)) {
          console.log("[ChatImageInput] user cancelled");
          setLocalPreview(null);
          return;
        }

        const errMsg = getReadableUploadError(pickerError);
        console.warn("[ChatImageInput] Native Camera picker failed, falling back to file input:", errMsg, pickerError);
        restoreNativeLayout();
        setUploading(false);
        fileInputRef.current?.click();
        return;
      }

      // Stabilize BottomNav immediately once picker returns, before blob/compression work.
      requestAnimationFrame(() => {
        restoreNativeLayout();
      });

      // NOW it's safe to set uploading state — the native picker has closed
      setUploading(true);

      const { blob, mimeType } = result;

      if (blob.size > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error("Image must be less than 10MB");
      }

      // Use a stable blob URL for preview instead of the capacitor temp path
      // which can become invalid on iOS shortly after the picker closes
      stablePreviewUrl = URL.createObjectURL(blob);

      // Blur again after picker closes — iOS may re-activate keyboard/accessory bar
      dismissIOSKeyboardAccessory();

      setLocalPreview(stablePreviewUrl);

      // Stabilize viewport immediately when the thumbnail appears (before upload completes)
      requestAnimationFrame(restoreNativeLayout);

      const skipCompression = !IOS_SAFE_COMPRESSION_MIME_TYPES.has(mimeType);
      let storageUrl: string;

      try {
        storageUrl = await uploadBlob(blob, { skipCompression });
      } catch (primaryUploadError) {
        if (!skipCompression) {
          console.warn("[ChatImageInput] Retrying native upload without compression:", primaryUploadError);
          storageUrl = await uploadBlob(blob, { skipCompression: true });
        } else {
          throw primaryUploadError;
        }
      }
      console.log("[ChatImageInput] upload complete:", storageUrl.substring(0, 80));
      setLocalPreview(null);
      onImageUploaded(storageUrl);
    } catch (error: unknown) {
      const errMsg = getReadableUploadError(error);
      console.error("[ChatImageInput] Image upload failed:", errMsg, error);
      toast.error(errMsg || "Failed to upload image");
      setLocalPreview(null);
    } finally {
      if (stablePreviewUrl) {
        URL.revokeObjectURL(stablePreviewUrl);
      }
      restoreNativeLayout();
      setUploading(false);
      // Clear lingering focus/active state on the image button after picker closes
      (document.activeElement as HTMLElement | null)?.blur();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      toast.error("Image must be less than 10MB");
      return;
    }

    if (shouldStabilizeIOSLayout) {
      requestAnimationFrame(() => {
        restoreNativeLayout();
      });
    }

    const localUrl = URL.createObjectURL(file);
    setLocalPreview(localUrl);
    setUploading(true);

    try {
      const storageUrl = await uploadBlob(file);
      URL.revokeObjectURL(localUrl);
      setLocalPreview(null);
      onImageUploaded(storageUrl);
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload image");
      URL.revokeObjectURL(localUrl);
      setLocalPreview(null);
    } finally {
      setUploading(false);
      if (shouldStabilizeIOSLayout) {
        restoreNativeLayout();
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleImageButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isNativeIOS) {
      // Do NOT call dismissIOSKeyboardAccessory() before Camera.getPhoto —
      // blurring breaks the gesture chain and iOS rejects the picker.
      void handleNativePhotoPick();
    } else {
      // Blur the button so its focus/active style doesn't persist after the
      // file picker closes (especially visible on Android WebView).
      (e.currentTarget as HTMLElement)?.blur();
      fileInputRef.current?.click();
      if (shouldStabilizeIOSLayout) {
        requestAnimationFrame(() => {
          restoreNativeLayout();
        });
      }
    }
  };

  const handleRemoveImage = () => {
    if (localPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(localPreview);
    }
    setLocalPreview(null);
    onImageUploaded(null);
    restoreNativeLayout();
  };

  const [previewFailed, setPreviewFailed] = useState(false);

  // Reset previewFailed when the image source changes
  useEffect(() => {
    setPreviewFailed(false);
  }, [localPreview, imageUrl]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && navGuardRetryTimeoutRef.current !== null) {
        window.clearTimeout(navGuardRetryTimeoutRef.current);
        navGuardRetryTimeoutRef.current = null;
      }
    };
  }, []);

  // When the parent clears an attached image after send, force a final iOS viewport settle
  useEffect(() => {
    const hasAttachment = Boolean(localPreview || imageUrl);

    if (shouldStabilizeIOSLayout && hadAttachmentRef.current && !hasAttachment && !uploading) {
      requestAnimationFrame(() => {
        restoreNativeLayout();
      });
    }

    hadAttachmentRef.current = hasAttachment;
  }, [imageUrl, localPreview, shouldStabilizeIOSLayout, uploading]);

  const displayUrl = localPreview || imageUrl;

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled || uploading}
      />

      {displayUrl ? (
        <div className="relative inline-block">
          {previewFailed ? (
            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
              <ImagePlus className="h-5 w-5 text-muted-foreground" />
            </div>
          ) : (
            <img
              src={displayUrl}
              alt="Attachment preview"
              className="h-10 w-10 object-cover rounded"
              onError={() => setPreviewFailed(true)}
            />
          )}
          {uploading && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          )}
          <button
            type="button"
            className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-sm"
            onClick={handleRemoveImage}
            disabled={disabled}
            aria-label="Remove image"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleImageButtonClick}
          disabled={disabled || uploading}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ImagePlus className="h-5 w-5" />
          )}
        </Button>
      )}
    </div>
  );
}
