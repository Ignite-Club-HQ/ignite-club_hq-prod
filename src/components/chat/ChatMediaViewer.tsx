import { useState } from "react";
import { format } from "date-fns";
import { Play, ImageIcon, Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { useChatSharedMedia, type ChatSharedMediaType, type SharedMediaItem } from "@/hooks/useChatSharedMedia";
import { isVideoUrl } from "@/lib/videoUtils";
import { SecureImage } from "@/components/SecureImage";
import { cn } from "@/lib/utils";

interface ChatMediaViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatType: ChatSharedMediaType;
  chatId: string | undefined;
  title?: string;
}

export function ChatMediaViewer({
  open,
  onOpenChange,
  chatType,
  chatId,
  title = "Shared in chat",
}: ChatMediaViewerProps) {
  const { data: items = [], isLoading } = useChatSharedMedia(chatType, chatId, {
    limit: 200,
    enabled: open,
  });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeItem = activeIndex !== null ? items[activeIndex] ?? null : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="p-0 sm:max-w-2xl gap-0 max-h-[90vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="text-xs text-muted-foreground">
                {isLoading ? "Loading…" : `${items.length} item${items.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>

          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">No media yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Photos and videos shared in this chat will appear here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1 p-1">
                {items.map((item, i) => (
                  <MediaThumb
                    key={item.id}
                    item={item}
                    onClick={() => setActiveIndex(i)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>

          {activeItem && (
            <div className="px-4 py-2 border-t bg-muted/30">
              <p className="text-xs text-muted-foreground truncate">
                {activeItem.author_name || "Unknown"} · {format(new Date(activeItem.created_at), "MMM d, h:mm a")}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {activeIndex !== null && items.length > 0 && (
        <PhotoLightbox
          isOpen={activeIndex !== null}
          onClose={() => setActiveIndex(null)}
          photos={items.map((it) => ({
            id: it.id,
            image_url: it.image_url,
            title: it.author_name ?? undefined,
          }))}
          currentIndex={activeIndex}
          onNavigate={(idx) => setActiveIndex(idx)}
        />
      )}
    </>
  );
}

function MediaThumb({ item, onClick }: { item: SharedMediaItem; onClick: () => void }) {
  const isVideo = isVideoUrl(item.image_url);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative aspect-square overflow-hidden rounded-md bg-muted",
        "active:opacity-80 transition-opacity touch-manipulation",
      )}
    >
      <SecureImage
        src={item.image_url}
        alt="Shared media"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="h-9 w-9 rounded-full bg-black/60 flex items-center justify-center">
            <Play className="h-4 w-4 text-white fill-white" />
          </div>
        </div>
      )}
    </button>
  );
}
