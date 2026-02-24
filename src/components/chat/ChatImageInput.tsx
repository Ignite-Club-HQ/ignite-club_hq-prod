import { useState, useRef } from "react";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (max 10MB for original, will be compressed)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be less than 10MB");
      return;
    }

    // Show local preview immediately for instant feedback
    const localUrl = URL.createObjectURL(file);
    setLocalPreview(localUrl);
    setUploading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Compress image before uploading
      const compressedBlob = await compressImage(file);
      
      // Structure path with club/team context for easier backup identification
      const timestamp = Date.now();
      let fileName: string;
      if (teamId && clubId) {
        fileName = `clubs/${clubId}/teams/${teamId}/${user.id}/${timestamp}.jpg`;
      } else if (clubId) {
        fileName = `clubs/${clubId}/${user.id}/${timestamp}.jpg`;
      } else {
        // Fallback for broadcast or unassociated chats
        fileName = `general/${user.id}/${timestamp}.jpg`;
      }

      const { error: uploadError } = await supabase.storage
        .from("chat-attachments")
        .upload(fileName, compressedBlob, {
          contentType: "image/jpeg"
        });

      if (uploadError) throw uploadError;

      // Store the storage URL format (will be converted to signed URL when displayed)
      const supabaseUrl = "https://yabcfiuntwqjwvschnji.supabase.co";
      const storageUrl = `${supabaseUrl}/storage/v1/object/public/chat-attachments/${fileName}`;

      // Clean up local preview
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
        accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/heic,image/heif,image/svg+xml,image/bmp,image/tiff"
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
          onClick={() => fileInputRef.current?.click()}
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
