import { useState, useRef, useEffect } from "react";
import { ImagePlus, X, Loader2, CalendarPlus, BarChart3, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";

import { compressImage as compressImageFile } from "@/lib/imageCompression";
import { mimeToExtension } from "@/lib/binaryUtils";
import { getReadableUploadError, isCancelledSelectionError } from "@/lib/uploadErrorUtils";
import { pickNativePhoto, shouldUseNativePicker } from "@/lib/nativePhotoPicker";
import { isIOSEnvironment, scheduleIOSNativeOverlayRecovery, temporarilyReleaseBodyScrollLock } from "@/lib/iosNativeOverlayRecovery";

interface ChatImageInputProps {
  onImageUploaded: (imageUrl: string | null) => void;
  imageUrl: string | null;
  disabled?: boolean;
  clubId?: string;
  teamId?: string;
  onEventSelect?: (eventId: string) => void;
  showEventPicker?: boolean;
  onPollCreate?: () => void;
  showPollCreator?: boolean;
  /** When true, the action icons are hidden and only the image preview (if any) is shown */
  hasText?: boolean;
}

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const IOS_SAFE_COMPRESSION_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function ChatImageInput({ onImageUploaded, imageUrl, disabled, clubId, teamId, onEventSelect, showEventPicker = false, onPollCreate, showPollCreator = false, hasText = false }: ChatImageInputProps) {
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hadAttachmentRef = useRef(false);
  const recoveryCleanupRef = useRef<(() => void) | null>(null);
  const platform = Capacitor.getPlatform();
  const isNativeIOS = Capacitor.isNativePlatform() && platform === "ios";
  const shouldStabilizeIOSLayout = isIOSEnvironment();

  const dismissIOSKeyboardAccessory = () => {
    if (!isNativeIOS) return;
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const restoreNativeLayout = () => {
    if (!shouldStabilizeIOSLayout) return;
    recoveryCleanupRef.current?.();
    recoveryCleanupRef.current = scheduleIOSNativeOverlayRecovery();
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
    console.log("[ChatImageInput] handleNativePhotoPick START");
    let stablePreviewUrl: string | null = null;
    const restoreBodyScrollLock = temporarilyReleaseBodyScrollLock();

    try {
      const result = await pickNativePhoto({ quality: 80 });
      console.log("[ChatImageInput] pickNativePhoto OK, blob size:", result.blob.size, "mime:", result.mimeType);

      requestAnimationFrame(() => {
        restoreNativeLayout();
      });

      setUploading(true);

      const { blob, mimeType } = result;

      if (blob.size > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error("Image must be less than 10MB");
      }

      stablePreviewUrl = URL.createObjectURL(blob);
      dismissIOSKeyboardAccessory();
      setLocalPreview(stablePreviewUrl);
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
      if (isCancelledSelectionError(error)) {
        console.log("[ChatImageInput] user cancelled photo selection");
      } else {
        const errMsg = getReadableUploadError(error);
        console.error("[ChatImageInput] Image upload failed:", errMsg, error);
        toast.error(errMsg || "Failed to upload image");
      }
      setLocalPreview(null);
    } finally {
      if (stablePreviewUrl) {
        URL.revokeObjectURL(stablePreviewUrl);
      }
      restoreBodyScrollLock();
      restoreNativeLayout();
      setUploading(false);
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
    if (shouldUseNativePicker()) {
      void handleNativePhotoPick();
    } else {
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

  useEffect(() => {
    setPreviewFailed(false);
  }, [localPreview, imageUrl]);

  useEffect(() => {
    return () => {
      recoveryCleanupRef.current?.();
    };
  }, []);

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

  // If there's an image attached, always show the preview regardless of hasText
  if (displayUrl) {
    return (
      <div className="flex shrink-0 items-center gap-2 self-end">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="sr-only"
          disabled={disabled || uploading}
        />
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
      </div>
    );
  }

  // Hide action icons when user is typing
  if (hasText) {
    return (
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="sr-only"
        disabled={disabled || uploading}
      />
    );
  }

  // Show photo button inline; event + poll behind a "+" popover
  const hasExtraActions = (showEventPicker && onEventSelect) || (showPollCreator && onPollCreate);

  return (
    <div className="flex shrink-0 items-center gap-2 self-end pl-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="sr-only"
        disabled={disabled || uploading}
      />
      <button
        type="button"
        onClick={handleImageButtonClick}
        disabled={disabled || uploading}
        className="flex items-center justify-center min-h-[44px] min-w-[44px] shrink-0 text-foreground hover:text-primary transition-colors disabled:opacity-50"
        aria-label="Upload photo"
      >
        {uploading ? (
          <Loader2 className="h-[22px] w-[22px] animate-spin" />
        ) : (
          <ImagePlus className="h-[22px] w-[22px]" strokeWidth={2.25} />
        )}
      </button>
      {hasExtraActions && (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] shrink-0 text-muted-foreground/70 hover:text-foreground transition-colors disabled:opacity-50"
              aria-label="More actions"
            >
              <Plus className="h-[22px] w-[22px]" strokeWidth={2.25} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-auto p-2">
            <div className="flex items-center gap-1">
              {showEventPicker && onEventSelect && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onEventSelect("");
                  }}
                  disabled={disabled}
                  className="flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-md hover:bg-accent text-foreground transition-colors disabled:opacity-50"
                  aria-label="Share event"
                >
                  <CalendarPlus className="h-[22px] w-[22px]" strokeWidth={1.75} />
                  <span className="text-[11px]">Event</span>
                </button>
              )}
              {showPollCreator && onPollCreate && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onPollCreate();
                  }}
                  disabled={disabled}
                  className="flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-md hover:bg-accent text-foreground transition-colors disabled:opacity-50"
                  aria-label="Create poll"
                >
                  <BarChart3 className="h-[22px] w-[22px]" strokeWidth={1.75} />
                  <span className="text-[11px]">Poll</span>
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
