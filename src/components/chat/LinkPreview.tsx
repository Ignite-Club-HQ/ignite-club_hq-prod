import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { safeOpenUrl } from "@/lib/safeOpenUrl";

interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

interface LinkPreviewProps {
  url: string;
  onRemove?: () => void;
  compact?: boolean;
}

// Skip link previews for app's own domains
const isAppDomain = (url: string): boolean => {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = urlObj.hostname.toLowerCase();
    return (
      host.includes('lovable.app') ||
      host.includes('lovableproject.com') ||
      host.includes('igniteclubhq.app')
    );
  } catch {
    return false;
  }
};

export function LinkPreview({ url, onRemove, compact = false }: LinkPreviewProps) {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Skip previews for app's own domains
  const skipPreview = isAppDomain(url);

  useEffect(() => {
    // Don't fetch previews for app domains
    if (skipPreview) {
      setLoading(false);
      return;
    }

    const fetchPreview = async () => {
      try {
        setLoading(true);
        setError(false);

        // Ensure URL has protocol
        let fetchUrl = url;
        if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
          fetchUrl = `https://${fetchUrl}`;
        }

        const { data, error: fnError } = await supabase.functions.invoke("fetch-link-preview", {
          body: { url: fetchUrl },
        });

        if (fnError) throw fnError;
        setPreview(data);
      } catch (err) {
        console.error("Failed to fetch link preview:", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchPreview();
  }, [url, skipPreview]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-1">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading preview...</span>
      </div>
    );
  }

  // Check if preview has any meaningful content
  const hasContent = preview && (preview.title || preview.description || preview.image);

  // If no preview content or skipped, don't render anything (link is shown inline)
  if (error || !preview || !hasContent || skipPreview) {
    return null;
  }

  const fullUrl = url.startsWith('http') ? url : `https://${url}`;

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    safeOpenUrl(fullUrl);
  };

  return (
    <div
      className="flex w-full max-w-full min-w-0 box-border items-start gap-3 overflow-hidden rounded-lg border border-border/40 bg-muted/80 px-3 py-2 transition-opacity cursor-pointer active:opacity-80 dark:bg-muted/60"
      onClick={handleCardClick}
      onTouchEnd={(e) => e.stopPropagation()}
      role="link"
    >
      {preview.image && (
        <div className="w-16 h-16 shrink-0 rounded overflow-hidden">
          <img
            src={preview.image}
            alt={preview.title || "Link preview"}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        </div>
      )}
      <div className="flex flex-1 min-w-0 flex-col justify-center overflow-hidden">
        {preview.siteName && (
          <p className="text-xs text-muted-foreground truncate">{preview.siteName}</p>
        )}
        {preview.title && (
          <p className="text-sm font-medium truncate">{preview.title}</p>
        )}
        {!compact && preview.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{preview.description}</p>
        )}
        <p className="text-xs text-muted-foreground truncate mt-0.5 text-left max-w-full">
          {url.length > 50 ? url.slice(0, 47) + '…' : url}
        </p>
      </div>
      {onRemove && (
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
