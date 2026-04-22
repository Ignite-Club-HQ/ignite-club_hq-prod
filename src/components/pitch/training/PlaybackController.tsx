import { memo } from "react";
import { cn } from "@/lib/utils";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Gauge,
  Presentation,
} from "lucide-react";
import type { PlaybackSpeed } from "@/hooks/useDrillPlayback";

interface PlaybackControllerProps {
  isPlaying: boolean;
  speed: PlaybackSpeed;
  currentIndex: number;
  frameCount: number;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSpeedChange: (s: PlaybackSpeed) => void;
  onPresent: () => void;
  className?: string;
}

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2];

function PlaybackControllerImpl({
  isPlaying,
  speed,
  currentIndex,
  frameCount,
  onToggle,
  onPrev,
  onNext,
  onSpeedChange,
  onPresent,
  className,
}: PlaybackControllerProps) {
  const canPlay = frameCount > 1;
  return (
    <div
      className={cn(
        "w-full bg-background/95 backdrop-blur border-t border-border px-2 py-1.5 shrink-0",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onPrev}
            disabled={currentIndex === 0}
            aria-label="Previous frame"
            className="h-9 w-9 rounded-md flex items-center justify-center border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            
            aria-label={isPlaying ? "Pause" : "Play"}
            title={!canPlay ? "Add a second frame to animate" : undefined}
            className={cn(
              "h-10 w-10 rounded-full flex items-center justify-center shadow",
              "bg-primary text-primary-foreground hover:opacity-90",
              !canPlay && "opacity-40"
            )}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={currentIndex >= frameCount - 1}
            aria-label="Next frame"
            className="h-9 w-9 rounded-md flex items-center justify-center border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <div className="text-xs font-medium text-muted-foreground tabular-nums">
          Frame {currentIndex + 1} / {frameCount}
        </div>

        <div className="flex items-center gap-1.5">
          <div
            className="inline-flex items-center rounded-md border border-border bg-muted p-0.5"
            role="group"
            aria-label="Playback speed"
          >
            <Gauge className="h-3.5 w-3.5 mx-1 text-muted-foreground" />
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSpeedChange(s)}
                aria-pressed={speed === s}
                className={cn(
                  "px-1.5 py-0.5 text-[11px] font-medium rounded-sm transition-colors",
                  speed === s
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {s}x
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onPresent}
            disabled={frameCount === 0}
            aria-label="Presentation mode"
            className="h-9 px-2.5 rounded-md flex items-center gap-1 border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40"
          >
            <Presentation className="h-4 w-4" />
            <span className="text-xs font-medium hidden sm:inline">Present</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export const PlaybackController = memo(PlaybackControllerImpl);
