import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SharePhotoButtonProps {
  photoId: string;
  imageUrl: string;
  title?: string;
}

const DEEP_LINK_BASE = "https://igniteclubhq.app";

export function SharePhotoButton({ photoId, imageUrl, title }: SharePhotoButtonProps) {
  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const shareTitle = title || "Check out this photo on Ignite!";
    const deepLink = `${DEEP_LINK_BASE}/media/${photoId}`;

    // Use Web Share API for native share sheet (Messenger, WhatsApp, etc.)
    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareTitle,
          url: deepLink,
        });
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        console.log("Web Share failed, falling back to clipboard:", error);
      }
    }

    // Fallback: copy deep link to clipboard
    try {
      await navigator.clipboard.writeText(deepLink);
      toast.success("Link copied to clipboard!");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = deepLink;
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
      className="h-11 w-11 text-muted-foreground hover:text-primary"
      onClick={handleShare}
      title="Share photo"
    >
      <Share2 className="h-6 w-6" />
    </Button>
  );
}
