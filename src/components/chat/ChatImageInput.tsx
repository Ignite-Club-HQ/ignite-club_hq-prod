import { useState, useRef } from "react";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { compressImage as compressImageFile } from "@/lib/imageCompression";

interface ChatImageInputProps {
  onImageUploaded: (imageUrl: string | null) => void;
  imageUrl: string | null;
  disabled?: boolean;
  clubId?: string;
  teamId?: string;
}

const mimeToExtension = (mimeType: string) => {
  const normalizedType = mimeType.toLowerCase();

  if (normalizedType.includes("png")) return "png";
  if (normalizedType.includes("gif")) return "gif";
  if (normalizedType.includes("webp")) return "webp";
  if (normalizedType.includes("heic")) return "heic";
  if (normalizedType.includes("heif")) return "heif";

  return "jpg";
};

export function ChatImageInput({ onImageUploaded, imageUrl, disabled, clubId, teamId }: ChatImageInputProps) {
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadBlob = async (blob: Blob) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const originalMimeType = blob.type || "image/jpeg";
    const sourceFile = new File(
      [blob],
      `photo.${mimeToExtension(originalMimeType)}`,
      { type: originalMimeType }
    );

    // Compression can fail for some iOS-native formats (e.g. HEIC) so we fail open.
    const { file: fileToUpload } = await compressImageFile(sourceFile);
    const contentType = fileToUpload.type || originalMimeType || "image/jpeg";
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
      .upload(fileName, fileToUpload, { contentType });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("chat-attachments").getPublicUrl(fileName);
    return data.publicUrl;
  };

  const handleNativePhotoPick = async () => {
    setUploading(true);
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Photos,
        quality: 80,
      });

      if (!photo.base64String) throw new Error("No photo selected");

      const normalizedFormat = (photo.format || "jpeg").toLowerCase();
      const formatToMime: Record<string, string> = {
        jpeg: "image/jpeg",
        jpg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        heic: "image/heic",
        heif: "image/heif",
      };
      const mimeType = formatToMime[normalizedFormat] || "image/jpeg";

      // Convert base64 to blob
      const byteString = atob(photo.base64String);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mimeType });

      setLocalPreview(`data:${mimeType};base64,${photo.base64String}`);

      const storageUrl = await uploadBlob(blob);
      setLocalPreview(null);
      onImageUploaded(storageUrl);
    } catch (error: any) {
      if (error?.message?.includes("cancelled") || error?.message?.includes("canceled")) {
        // User cancelled - do nothing
      } else {
        console.error("Upload error:", error);
        toast.error("Failed to upload image");
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

    if (file.size > 10 * 1024 * 1024) {
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
    if (Capacitor.getPlatform() === 'ios') {
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
