import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

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

export function LinkPreview({ url, onRemove, compact = false }: LinkPreviewProps) {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
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
  }, [url]);

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

  // If no preview content, don't render anything (link is shown inline)
  if (error || !preview || !hasContent) {
    return null;
  }

  return (
    <div className="flex gap-3 py-2">
      {preview.image && (
        <div className="w-16 h-16 shrink-0 rounded overflow-hidden">
          <img
            src={preview.image}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        {preview.siteName && (
          <p className="text-xs text-muted-foreground truncate">{preview.siteName}</p>
        )}
        {preview.title && (
          <p className="text-sm font-medium truncate">{preview.title}</p>
        )}
        {!compact && preview.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{preview.description}</p>
        )}
        <a
          href={url.startsWith('http') ? url : `https://${url}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground truncate hover:underline mt-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>
      </div>
      {onRemove && (
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
