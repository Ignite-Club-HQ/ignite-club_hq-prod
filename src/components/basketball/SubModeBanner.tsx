import { ArrowLeftRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BasketballPlayer } from "./types";

interface SubModeBannerProps {
  selectedPlayer: BasketballPlayer;
  onCancel: () => void;
}

/**
 * Persistent header shown whenever a player is selected for a sub.
 * Mirrors the netball/soccer pattern: the coach always knows who's "picked
 * up" and how to back out. Glanceable, non-blocking, never confirms.
 */
export default function SubModeBanner({ selectedPlayer, onCancel }: SubModeBannerProps) {
  const onCourt = selectedPlayer.position !== null;
  return (
    <div
      className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between gap-2 px-3 py-2 bg-primary/95 text-primary-foreground border-b border-primary-foreground/10 shadow-md backdrop-blur-md animate-fade-in"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 min-w-0">
        <ArrowLeftRight className="h-4 w-4 shrink-0 animate-pulse" />
        <div className="min-w-0">
          <p className="text-xs font-bold leading-tight truncate">
            {onCourt ? "Subbing OFF: " : "Subbing ON: "}
            {selectedPlayer.name}
            {selectedPlayer.position && (
              <span className="font-normal opacity-80"> · {selectedPlayer.position}</span>
            )}
          </p>
          <p className="text-[10px] leading-tight opacity-90">
            {onCourt
              ? "Tap a bench player to swap"
              : "Tap a court player to swap"}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="h-8 px-2 text-xs gap-1 shrink-0"
        onClick={onCancel}
      >
        <X className="h-3.5 w-3.5" />
        Cancel
      </Button>
    </div>
  );
}
