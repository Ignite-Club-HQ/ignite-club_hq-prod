import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrillFrame } from "@/components/pitch/training/types";
import {
  interpolateFrames,
  staticFrame,
  type InterpolatedFrame,
} from "@/components/pitch/training/interpolation";
import { withRotationTransition } from "@/components/pitch/training/playerRotation";
import { normalizeFramesForPlayback } from "@/components/pitch/training/normalizeFrames";

export type PlaybackSpeed = 0.5 | 1 | 2;

interface UseDrillPlaybackOptions {
  frames: DrillFrame[];
  /** When playback ends naturally, optionally loop */
  loop?: boolean;
}

interface UseDrillPlaybackReturn {
  /** Current visible frame index (0-based, snaps to nearest while paused) */
  currentIndex: number;
  /** Live interpolated state to render */
  view: InterpolatedFrame;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
  /** Reset to first frame and pause */
  reset: () => void;
  /**
   * Number of AUTHORED frames the caller passed in. UI counters/jump-buttons
   * should use this — it intentionally excludes the synthetic rotation
   * transition frame appended internally when looping is enabled.
   */
  authoredFrameCount: number;
  /**
   * Currently visible authored-frame index, clamped so the synthetic rotation
   * transition surfaces as "still on the last authored frame" for UI
   * highlighting purposes.
   */
  authoredIndex: number;
}

/**
 * Plays back a sequence of drill frames with rAF-based interpolation.
 * - If 1 frame: returns a static view; play is a no-op.
 * - Each transition uses the SOURCE frame's durationMs / speed.
 */
export function useDrillPlayback({
  frames: rawFrames,
  loop = false,
}: UseDrillPlaybackOptions): UseDrillPlaybackReturn {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [cycleStep, setCycleStep] = useState(0);

  // Effective frames include a synthetic "rotate to next position" transition
  // appended after the last frame. This makes every drill end its play-through
  // by visibly cycling each player to the next player's starting spot.
  //
  // IMPORTANT: only append the rotation transition when looping is enabled.
  // In the editor (loop=false) we never want chips to drift away from the
  // authored positions when playback finishes — that looks like chips
  // "disappeared" or "moved on their own".
  const frames = useMemo(() => {
    // Step 1: ensure no player chip vanishes mid-drill. Legacy drills sometimes
    // omit chips from intermediate frames, which made them fade out and pop
    // back in during playback. Hold each chip in its last known position when
    // a frame doesn't author it.
    const normalized = normalizeFramesForPlayback(rawFrames);
    // Step 2: optionally append the synthetic rotation transition (loop only).
    return loop ? withRotationTransition(normalized, cycleStep) : normalized;
  }, [rawFrames, cycleStep, loop]);

  const [view, setView] = useState<InterpolatedFrame>(() =>
    frames[0] ? staticFrame(frames[0]) : { objects: [], annotations: [] }
  );

  const rafRef = useRef<number | null>(null);
  const segmentStartRef = useRef<number>(0);
  const segmentIndexRef = useRef<number>(0);

  // Keep view in sync when frames change or index changes (while paused)
  useEffect(() => {
    if (isPlaying) return;
    const f = frames[currentIndex];
    if (f) setView(staticFrame(f));
    else setView({ objects: [], annotations: [] });
  }, [frames, currentIndex, isPlaying]);

  // Reset the rotation cycle whenever the underlying drill's IDENTITY changes
  // (different drill loaded, frames added/removed). We deliberately compare by
  // length + first frame id rather than by array reference so that callers
  // re-creating the same logical frame array each render don't keep stomping
  // the cycle counter back to 0 mid-playback.
  const drillSignature = useMemo(() => {
    if (rawFrames.length === 0) return "empty";
    return `${rawFrames.length}:${rawFrames[0]?.id ?? ""}:${rawFrames[rawFrames.length - 1]?.id ?? ""}`;
  }, [rawFrames]);
  useEffect(() => {
    setCycleStep(0);
  }, [drillSignature]);

  // Clamp index if frames shrink
  useEffect(() => {
    if (currentIndex > frames.length - 1) {
      setCurrentIndex(Math.max(0, frames.length - 1));
    }
  }, [frames.length, currentIndex]);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      stopRaf();
      return;
    }
    if (frames.length < 2) {
      setIsPlaying(false);
      return;
    }

    segmentIndexRef.current = currentIndex;
    segmentStartRef.current = performance.now();

    const tick = (now: number) => {
      const fromIdx = segmentIndexRef.current;
      const toIdx = fromIdx + 1;
      const from = frames[fromIdx];
      const to = frames[toIdx];

      if (!to) {
        // End of sequence (after the rotation transition has played).
        if (loop) {
          // Advance the cycle so the next iteration starts each player at the
          // next slot they just rotated into. The frames memo will rebuild and
          // the effect will re-run from index 0.
          setCycleStep((c) => c + 1);
          setCurrentIndex(0);
          return;
        }
        if (from) setView(staticFrame(from));
        setIsPlaying(false);
        return;
      }

      const dur = Math.max(50, (from.durationMs || 1500) / speed);
      const elapsed = now - segmentStartRef.current;
      const t = elapsed / dur;

      if (t >= 1) {
        // Advance to next segment
        segmentIndexRef.current = toIdx;
        segmentStartRef.current = now;
        setCurrentIndex(toIdx);
        setView(staticFrame(to));
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      setView(interpolateFrames(from, to, t));
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return stopRaf;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, frames, speed, loop, stopRaf]);

  const play = useCallback(() => {
    if (frames.length < 2) return;
    // If we're at the end, restart
    if (currentIndex >= frames.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(true);
  }, [frames.length, currentIndex]);

  const pause = useCallback(() => setIsPlaying(false), []);

  const toggle = useCallback(() => {
    setIsPlaying((p) => {
      if (!p && frames.length < 2) return false;
      if (!p && currentIndex >= frames.length - 1) {
        setCurrentIndex(0);
      }
      return !p;
    });
  }, [frames.length, currentIndex]);

  const next = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex((i) => Math.min(frames.length - 1, i + 1));
  }, [frames.length]);

  const prev = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);

  const goTo = useCallback(
    (index: number) => {
      setIsPlaying(false);
      setCurrentIndex(Math.max(0, Math.min(frames.length - 1, index)));
    },
    [frames.length]
  );

  const reset = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex(0);
    setCycleStep(0);
  }, []);

  const authoredFrameCount = rawFrames.length;
  const authoredIndex = Math.min(currentIndex, Math.max(0, authoredFrameCount - 1));

  return {
    currentIndex,
    view,
    isPlaying,
    speed,
    play,
    pause,
    toggle,
    next,
    prev,
    goTo,
    setSpeed,
    reset,
    authoredFrameCount,
    authoredIndex,
  };
}
