import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Play, Pause, StickyNote, Keyboard, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DrillFrame } from "./types";
import { TrainingObjectLayer } from "./TrainingObjectLayer";
import { useDrillPlayback } from "@/hooks/useDrillPlayback";
import { applyTeamPlayersToObjects, substitutePlayerNamesInNotes, type TeamPlayerLite } from "./teamPlayerSubstitution";

interface PresentationModeProps {
  frames: DrillFrame[];
  initialIndex?: number;
  onClose: () => void;
  /** Real squad players — when provided their names replace the generic "1/2/3..." labels. */
  teamPlayers?: TeamPlayerLite[];
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

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Space"], label: "Play / Pause" },
  { keys: ["←", "→"], label: "Previous / Next frame" },
  { keys: ["N"], label: "Toggle coaching notes" },
  { keys: ["?"], label: "Show / hide shortcuts" },
  { keys: ["Esc"], label: "Exit presentation" },
];

/**
 * Fullscreen, distraction-free playback for live coaching use.
 * - Tap pitch / arrow keys / space to advance
 * - Hides editor UI; only shows minimal controls
 * - Optional notes overlay (toggleable)
 * - Visible progress bar with jump-to-frame buttons
 * - Keyboard shortcut overlay (press ? to view)
 */
export default function PresentationMode({
  frames,
  initialIndex = 0,
  onClose,
  teamPlayers,
}: PresentationModeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showNotes, setShowNotes] = useState(true);
  const [useTeamRoster, setUseTeamRoster] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const {
    currentIndex,
    view,
    isPlaying,
    toggle,
    next,
    prev,
    goTo,
    authoredFrameCount,
    authoredIndex,
  } = useDrillPlayback({ frames, loop: true });

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
        if (showShortcuts) {
          setShowShortcuts(false);
        } else {
          onClose();
        }
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
      } else if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setShowShortcuts((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, toggle, onClose, showShortcuts]);

  const total = authoredFrameCount;
  // Progress shown as fraction of frames "completed" (authoredIndex / lastIndex)
  const progressPct = total > 1 ? (authoredIndex / (total - 1)) * 100 : 100;

  const hasTeamPlayers = (teamPlayers?.length ?? 0) > 0;
  const renderedObjects = useMemo(() => {
    if (!useTeamRoster) return view.objects;
    // Always filter when roster mode is on so fake numeric chips never appear,
    // even if zero real players are mapped.
    return applyTeamPlayersToObjects(view.objects, teamPlayers ?? []);
  }, [view.objects, teamPlayers, useTeamRoster]);

  // Replace placeholder tokens in coaching notes (A1, D2, GK1...) with real
  // squad names so the spoken-style note matches the chip on the pitch.
  const renderedNotes = useMemo(() => {
    if (!view.notes) return view.notes;
    if (!useTeamRoster || !teamPlayers || teamPlayers.length === 0) return view.notes;
    return substitutePlayerNamesInNotes(view.notes, view.objects, teamPlayers);
  }, [view.notes, view.objects, teamPlayers, useTeamRoster]);

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
          Frame {authoredIndex + 1} / {total}
        </div>
        <div className="flex items-center gap-1.5">
          {hasTeamPlayers && (
            <button
              type="button"
              onClick={() => setUseTeamRoster((s) => !s)}
              aria-pressed={useTeamRoster}
              aria-label={useTeamRoster ? "Show generic player labels" : "Show team player names"}
              title={useTeamRoster ? "Showing team players" : "Showing generic labels"}
              className={cn(
                "h-9 w-9 rounded-md flex items-center justify-center",
                useTeamRoster ? "bg-white/20" : "hover:bg-white/10"
              )}
            >
              <Users className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowShortcuts((s) => !s)}
            aria-pressed={showShortcuts}
            aria-label="Keyboard shortcuts"
            className={cn(
              "h-9 w-9 rounded-md flex items-center justify-center",
              showShortcuts ? "bg-white/20" : "hover:bg-white/10"
            )}
          >
            <Keyboard className="h-4 w-4" />
          </button>
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
            objects={renderedObjects}
            annotations={view.annotations}
            containerRef={containerRef}
            readOnly
            isAnimating={isPlaying}
          />
          {showNotes && renderedNotes && (
            <div className="absolute left-1/2 bottom-3 -translate-x-1/2 max-w-[90%] px-3 py-2 rounded-md bg-black/70 text-white text-sm font-medium pointer-events-none shadow-lg">
              {renderedNotes}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-3 pt-2 bg-black/70">
        <div
          className="relative h-1.5 rounded-full bg-white/15 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPct)}
          aria-label="Drill progress"
        >
          <div
            className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Jump-to-frame buttons */}
      {total > 1 && (
        <div className="bg-black/70 px-3 pt-2">
          <div
            className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x"
            aria-label="Jump to frame"
          >
            {frames.map((_, i) => {
              const active = i === authoredIndex;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    goTo(i);
                  }}
                  aria-label={`Go to frame ${i + 1}`}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "shrink-0 snap-start h-8 min-w-8 px-2 rounded-md text-xs font-semibold tabular-nums flex items-center justify-center transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow"
                      : "bg-white/10 text-white/80 hover:bg-white/20"
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      )}

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

      {/* Keyboard shortcut overlay */}
      {showShortcuts && (
        <div
          className="absolute inset-0 z-10 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowShortcuts(false)}
          role="dialog"
          aria-label="Keyboard shortcuts"
        >
          <div
            className="w-full max-w-sm rounded-xl bg-card text-card-foreground shadow-2xl border border-border overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Keyboard className="h-4 w-4" />
                <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowShortcuts(false)}
                aria-label="Close shortcuts"
                className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="divide-y divide-border">
              {SHORTCUTS.map(({ keys, label }) => (
                <li
                  key={label}
                  className="flex items-center justify-between px-4 py-2.5 text-sm"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="flex items-center gap-1">
                    {keys.map((k) => (
                      <kbd
                        key={k}
                        className="inline-flex min-w-7 h-7 items-center justify-center px-1.5 rounded-md border border-border bg-muted font-mono text-xs font-semibold text-foreground"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <div className="px-4 py-2 text-[11px] text-muted-foreground bg-muted/40 text-center">
              Tap the pitch to advance · Tip: press <kbd className="px-1 font-mono">?</kbd> any time
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}
