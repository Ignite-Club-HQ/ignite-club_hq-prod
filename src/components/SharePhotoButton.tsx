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

    // Try native Web Share API first
    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          url: imageUrl,
        });
        return; // Success - exit early
      } catch (error) {
        // If user cancelled, don't show error
        if ((error as Error).name === "AbortError") {
          return;
        }
        // If share failed, fall through to clipboard fallback
        console.log("Web Share failed, falling back to clipboard:", error);
      }
    }

    // Fallback: copy link to clipboard
    try {
      await navigator.clipboard.writeText(imageUrl);
      toast.success("Link copied to clipboard!");
    } catch {
      // Final fallback: use a temporary textarea
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
