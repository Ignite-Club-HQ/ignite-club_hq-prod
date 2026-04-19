import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface GiphyResult {
  id: string;
  title: string;
  preview: string;
  previewWidth: number;
  previewHeight: number;
  url: string;
  width: number;
  height: number;
}

interface GifPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (gifUrl: string) => void;
}

export function GifPickerSheet({ open, onOpenChange, onSelect }: GifPickerSheetProps) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GiphyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const fetchGifs = async (q: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("giphy-search", {
        body: { query: q, limit: 24 },
      });
      if (error) throw error;
      setGifs((data?.gifs as GiphyResult[]) || []);
    } catch (err) {
      console.error("[GifPickerSheet] fetch failed:", err);
      toast.error("Couldn't load GIFs. Please try again.");
      setGifs([]);
    } finally {
      setLoading(false);
    }
  };

  // Load trending on open
  useEffect(() => {
    if (open) {
      setQuery("");
      fetchGifs("");
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      fetchGifs(query);
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  const handlePick = (gif: GiphyResult) => {
    onSelect(gif.url);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[85vh] max-h-[85vh] flex flex-col overflow-hidden p-0"
      >
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
          <SheetTitle className="text-left">Choose a GIF</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search GIPHY"
              className="pl-9 pr-9 h-11"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full hover:bg-accent text-muted-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Powered by GIPHY</p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {loading && gifs.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : gifs.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No GIFs found. Try another search.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {gifs.map((gif) => {
                const aspect = gif.previewHeight / Math.max(gif.previewWidth, 1);
                return (
                  <button
                    key={gif.id}
                    type="button"
                    onClick={() => handlePick(gif)}
                    className={cn(
                      "relative w-full overflow-hidden rounded-md bg-muted",
                      "active:opacity-80 transition-opacity",
                    )}
                    style={{ paddingBottom: `${aspect * 100}%` }}
                    aria-label={gif.title || "Select GIF"}
                  >
                    <img
                      src={gif.preview}
                      alt={gif.title}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
