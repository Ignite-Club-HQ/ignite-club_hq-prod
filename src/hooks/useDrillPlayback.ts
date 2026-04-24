import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrillFrame } from "@/components/pitch/training/types";
import {
  interpolateFrames,
  staticFrame,
  type InterpolatedFrame,
} from "@/components/pitch/training/interpolation";
import { withRotationTransition } from "@/components/pitch/training/playerRotation";

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
}

/**
 * Plays back a sequence of drill frames with rAF-based interpolation.
 * - If 1 frame: returns a static view; play is a no-op.
 * - Each transition uses the SOURCE frame's durationMs / speed.
 */
export function useDrillPlayback({
  frames,
  loop = false,
}: UseDrillPlaybackOptions): UseDrillPlaybackReturn {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
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
        // End of sequence
        if (loop) {
          segmentIndexRef.current = 0;
          segmentStartRef.current = now;
          setCurrentIndex(0);
          rafRef.current = requestAnimationFrame(tick);
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
  }, []);

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
  };
}
