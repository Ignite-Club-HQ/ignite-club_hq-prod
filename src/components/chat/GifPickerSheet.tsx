import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { GifGrid } from "@/components/chat/GifGrid";

interface GifPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (gifUrl: string) => void;
}

/**
 * Bottom-sheet GIF picker. Currently unused — the GIF picker is integrated
 * directly into the EmojiPicker as a tab. Kept for potential standalone use.
 */
export function GifPickerSheet({ open, onOpenChange, onSelect }: GifPickerSheetProps) {
  const handlePick = (gifUrl: string) => {
    onSelect(gifUrl);
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
        <div className="flex-1 min-h-0 px-4 pb-4">
          <GifGrid
            active={open}
            onSelect={handlePick}
            scrollClassName="flex-1 min-h-0"
            gridClassName="grid-cols-2 sm:grid-cols-3"
            className="h-full"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
