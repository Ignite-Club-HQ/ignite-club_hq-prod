import { useState, useRef } from "react";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { compressImage as compressImageFile } from "@/lib/imageCompression";
import { cameraPhotoToBlob, hasCameraPhotoSource, mimeToExtension } from "@/lib/binaryUtils";
import { getReadableUploadError, isCancelledSelectionError } from "@/lib/uploadErrorUtils";

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
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

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
    setUploading(true);
    try {
      let permissions = await Camera.checkPermissions();
      if (permissions.photos === "denied") {
        permissions = await Camera.requestPermissions();
      }

      if (permissions.photos === "denied") {
        throw new Error("Photo library access is denied");
      }

      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos,
        quality: 80,
        width: 1280,
        height: 1280,
      });

      if (!hasCameraPhotoSource(photo)) throw new Error("No photo selected (missing base64String/webPath/path)");

      const { blob, mimeType, previewUrl } = await cameraPhotoToBlob(photo);
      if (blob.size > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error("Image must be less than 10MB");
      }

      setLocalPreview(previewUrl);

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
      setLocalPreview(null);
      onImageUploaded(storageUrl);
    } catch (error: unknown) {
      if (isCancelledSelectionError(error)) {
        // User cancelled - do nothing
      } else {
        console.warn("[ChatImageInput] Native picker failed:", error);
        toast.error("Could not load photo. Please try again.");
      }
      setLocalPreview(null);
    } finally {
      setUploading(false);
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
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleImageButtonClick = () => {
    if (isNativeIOS) {
      handleNativePhotoPick();
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleRemoveImage = () => {
    if (localPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(localPreview);
    }
    setLocalPreview(null);
    onImageUploaded(null);
  };

  const displayUrl = localPreview || imageUrl;

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif"
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled || uploading}
      />

      {displayUrl ? (
        <div className="relative">
          <img
            src={displayUrl}
            alt="Attachment preview"
            className="h-10 w-10 object-cover rounded"
          />
          {uploading && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          )}
          <Button
            size="icon"
            variant="destructive"
            className="absolute -top-2 -right-2 h-5 w-5"
            onClick={handleRemoveImage}
            disabled={disabled}
          >
            <X className="h-3 w-3" />
          </Button>
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
