import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SharePhotoButtonProps {
  imageUrl: string;
  title?: string;
}

export function SharePhotoButton({ imageUrl, title }: SharePhotoButtonProps) {
  const handleShare = async () => {
    const shareTitle = title || "Check out this photo!";

    // Try sharing as a file (avoids exposing raw Supabase URL)
    if (navigator.share && navigator.canShare) {
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
        const file = new File([blob], `${shareTitle.replace(/[^a-zA-Z0-9 ]/g, "").trim() || "photo"}.${extension}`, {
          type: blob.type || "image/jpeg",
        });

        const shareData = { files: [file], title: shareTitle };

        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return;
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        console.log("File share failed, trying URL share:", error);
      }
    }

    // Fallback: share as URL (web browsers without file share support)
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, url: imageUrl });
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        console.log("Web Share failed, falling back to clipboard:", error);
      }
    }

    // Final fallback: copy link to clipboard
    try {
      await navigator.clipboard.writeText(imageUrl);
      toast.success("Link copied to clipboard!");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = imageUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      toast.success("Link copied to clipboard!");
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 text-muted-foreground hover:text-primary"
      onClick={handleShare}
      title="Share photo"
    >
      <Share2 className="h-4 w-4" />
    </Button>
  );
}
