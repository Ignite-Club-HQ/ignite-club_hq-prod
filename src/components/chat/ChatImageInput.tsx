import { useState, useRef } from "react";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

interface ChatImageInputProps {
  onImageUploaded: (imageUrl: string | null) => void;
  imageUrl: string | null;
  disabled?: boolean;
  clubId?: string;
  teamId?: string;
}

const MAX_WIDTH = 1200;
const MAX_HEIGHT = 1200;
const QUALITY = 0.8;

const compressImage = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      let { width, height } = img;

      // Calculate new dimensions maintaining aspect ratio
      if (width > MAX_WIDTH || height > MAX_HEIGHT) {
        const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;

      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to compress image"));
          }
        },
        "image/jpeg",
        QUALITY
      );
    };

    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
};

export function ChatImageInput({ onImageUploaded, imageUrl, disabled, clubId, teamId }: ChatImageInputProps) {
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadBlob = async (blob: Blob) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const compressedBlob = await compressImage(new File([blob], "photo.jpg", { type: blob.type }));
    
    const timestamp = Date.now();
    let fileName: string;
    if (teamId && clubId) {
      fileName = `clubs/${clubId}/teams/${teamId}/${user.id}/${timestamp}.jpg`;
    } else if (clubId) {
      fileName = `clubs/${clubId}/${user.id}/${timestamp}.jpg`;
    } else {
      fileName = `general/${user.id}/${timestamp}.jpg`;
    }

    const { error: uploadError } = await supabase.storage
      .from("chat-attachments")
      .upload(fileName, compressedBlob, { contentType: "image/jpeg" });

    if (uploadError) throw uploadError;

    const supabaseUrl = "https://yabcfiuntwqjwvschnji.supabase.co";
    return `${supabaseUrl}/storage/v1/object/public/chat-attachments/${fileName}`;
  };

  const handleNativePhotoPick = async () => {
    setUploading(true);
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos,
        quality: 80,
      });

      if (!photo.webPath) throw new Error("No photo selected");

      setLocalPreview(photo.webPath);

      const response = await fetch(photo.webPath);
      const blob = await response.blob();

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
    if (localPreview) {
      URL.revokeObjectURL(localPreview);
      setLocalPreview(null);
    }
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
