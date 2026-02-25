import { useState } from "react";
import { X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeOpenUrl } from "@/lib/safeOpenUrl";

interface FullscreenImageViewerProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function FullscreenImageViewer({ src, alt = "Image", onClose }: FullscreenImageViewerProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-4 right-4 text-white hover:bg-white/20 z-10"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <X className="h-6 w-6" />
      </Button>

      <Button
        size="icon"
        variant="ghost"
        className="absolute top-4 left-4 text-white hover:bg-white/20 z-10"
        onClick={(e) => { e.stopPropagation(); safeOpenUrl(src); }}
      >
        <Download className="h-6 w-6" />
      </Button>

      {!loaded && (
        <div className="animate-pulse bg-muted/20 rounded w-64 h-64" />
      )}
      <img
        src={src}
        alt={alt}
        className={`max-w-[95vw] max-h-[90vh] object-contain rounded transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
        onClick={(e) => e.stopPropagation()}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
