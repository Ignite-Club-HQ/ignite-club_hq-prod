import { ArrowLeftRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NetballPlayer, NETBALL_POSITION_LABELS } from "./types";

interface SubModeBannerProps {
  selectedPlayer: NetballPlayer;
  onCancel: () => void;
}

/**
 * Persistent header that appears whenever a player is selected for a sub.
 * Mirrors the soccer pitch board's clarity: the user always knows who's
 * "picked up" and how to back out. Without this banner, users got lost
 * tapping a court player and not realising swap-mode was active.
 */
export default function SubModeBanner({ selectedPlayer, onCancel }: SubModeBannerProps) {
  const onCourt = selectedPlayer.position !== null;
  return (
    <div
      className="flex items-center justify-between gap-2 px-3 py-2 bg-primary text-primary-foreground border-b shadow-sm animate-fade-in"
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
              <span className="font-normal opacity-80">
                {" · "}
                {NETBALL_POSITION_LABELS[selectedPlayer.position]}
              </span>
            )}
          </p>
          <p className="text-[10px] leading-tight opacity-90">
            {onCourt
              ? "Tap a bench player to swap, or an empty slot to move."
              : "Tap a court player to swap, or an empty slot to take."}
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
