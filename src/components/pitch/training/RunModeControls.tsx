import { memo } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Play, Pause } from "lucide-react";

interface RunModeControlsProps {
  isPlaying: boolean;
  currentIndex: number;
  frameCount: number;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
}

/**
 * Compact, coach-friendly bottom bar shown only in Run mode.
 *
 * Layout:
 *   [ ⏮ ]   [ ▶ Play / ⏸ Pause ]   [ ⏭ ]
 *               Step 1 of 5
 *
 * - Generous tap targets (44px+) so the coach can act without looking
 * - Centered controls, no redundant labels ("Frame 1/5" gone)
 * - Disabled states are visually obvious
 */
function RunModeControlsImpl({
  isPlaying,
  currentIndex,
  frameCount,
  onPrev,
  onNext,
  onTogglePlay,
}: RunModeControlsProps) {
  const canPlay = frameCount > 1;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex >= frameCount - 1;

  return (
    <div className="shrink-0 bg-background/95 backdrop-blur border-t border-border px-4 py-2.5 pb-safe">
      <div className="flex items-center justify-center gap-5">
        <button
          type="button"
          onClick={onPrev}
          disabled={isFirst}
          aria-label="Previous step"
          className={cn(
            "h-12 w-12 rounded-full flex items-center justify-center border border-border bg-background text-foreground transition-all",
            "active:scale-95 active:bg-muted",
            isFirst && "opacity-30",
          )}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          disabled={!canPlay}
          aria-label={isPlaying ? "Pause drill" : "Play drill"}
          className={cn(
            "h-14 w-14 rounded-full flex items-center justify-center shadow-lg transition-all",
            "bg-primary text-primary-foreground",
            "active:scale-95",
            !canPlay && "opacity-40",
          )}
        >
          {isPlaying ? (
            <Pause className="h-7 w-7" />
          ) : (
            <Play className="h-7 w-7 ml-0.5" />
          )}
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={isLast}
          aria-label="Next step"
          className={cn(
            "h-12 w-12 rounded-full flex items-center justify-center border border-border bg-background text-foreground transition-all",
            "active:scale-95 active:bg-muted",
            isLast && "opacity-30",
          )}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>
      <p className="mt-1.5 text-center text-xs font-medium text-muted-foreground tabular-nums">
        Step {currentIndex + 1} of {frameCount}
      </p>
    </div>
  );
}

export const RunModeControls = memo(RunModeControlsImpl);
export default RunModeControls;
