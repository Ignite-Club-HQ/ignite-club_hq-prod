import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Play, Pause, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DrillFrame } from "./types";
import { TrainingObjectLayer } from "./TrainingObjectLayer";
import { useDrillPlayback } from "@/hooks/useDrillPlayback";

interface PresentationModeProps {
  frames: DrillFrame[];
  initialIndex?: number;
  onClose: () => void;
}

function PitchMarkings() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <rect x="2" y="2" width="96" height="96" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <line x1="2" y1="50" x2="98" y2="50" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <circle cx="50" cy="50" r="9" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <circle cx="50" cy="50" r="0.7" fill="white" fillOpacity="0.7" />
      <rect x="22" y="2" width="56" height="14" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <rect x="36" y="2" width="28" height="6" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <rect x="22" y="84" width="56" height="14" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <rect x="36" y="92" width="28" height="6" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
    </svg>
  );
}

/**
 * Fullscreen, distraction-free playback for live coaching use.
 * - Tap pitch / arrow keys / space to advance
 * - Hides editor UI; only shows minimal controls
 * - Optional notes overlay (toggleable)
 */
export default function PresentationMode({
  frames,
  initialIndex = 0,
  onClose,
}: PresentationModeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showNotes, setShowNotes] = useState(true);
  const {
    currentIndex,
    view,
    isPlaying,
    toggle,
    next,
    prev,
    goTo,
  } = useDrillPlayback({ frames });

  // Honour initialIndex once on mount
  useEffect(() => {
    if (initialIndex > 0) goTo(initialIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key.toLowerCase() === "n") {
        setShowNotes((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, toggle, onClose]);

  const overlay = (
    <div
      className="fixed inset-0 z-[100] bg-black flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Drill presentation"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/70 text-white">
        <div className="text-xs font-medium tabular-nums">
          Frame {currentIndex + 1} / {frames.length}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowNotes((s) => !s)}
            aria-pressed={showNotes}
            aria-label="Toggle notes"
            className={cn(
              "h-9 w-9 rounded-md flex items-center justify-center",
              showNotes ? "bg-white/20" : "hover:bg-white/10"
            )}
          >
            <StickyNote className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Exit presentation"
            className="h-9 w-9 rounded-md flex items-center justify-center hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Pitch */}
      <div className="flex-1 min-h-0 p-2 flex items-center justify-center">
        <div
          ref={containerRef}
          onClick={() => next()}
          className="relative rounded-lg overflow-hidden shadow-lg select-none cursor-pointer w-full h-full max-w-full"
          style={{
            backgroundColor: "hsl(var(--pitch-green))",
            backgroundImage:
              "repeating-linear-gradient(0deg, hsla(0,0%,100%,0.03) 0 8%, transparent 8% 16%)",
          }}
        >
          <PitchMarkings />
          <TrainingObjectLayer
            objects={view.objects}
            annotations={view.annotations}
            containerRef={containerRef}
            readOnly
          />
          {showNotes && view.notes && (
            <div className="absolute left-1/2 bottom-3 -translate-x-1/2 max-w-[90%] px-3 py-2 rounded-md bg-black/70 text-white text-sm font-medium pointer-events-none shadow-lg">
              {view.notes}
            </div>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-3 px-3 py-3 bg-black/70 text-white">
        <button
          type="button"
          onClick={prev}
          disabled={currentIndex === 0}
          aria-label="Previous frame"
          className="h-11 w-11 rounded-full flex items-center justify-center bg-white/15 hover:bg-white/25 disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={toggle}
          disabled={frames.length < 2}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="h-12 w-12 rounded-full flex items-center justify-center bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={next}
          disabled={currentIndex >= frames.length - 1}
          aria-label="Next frame"
          className="h-11 w-11 rounded-full flex items-center justify-center bg-white/15 hover:bg-white/25 disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
