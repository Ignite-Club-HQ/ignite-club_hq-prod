import { useCallback, useEffect, useState } from "react";

/**
 * Persisted, device-local preferences for Training Mode.
 *
 * These are intentionally NOT synced to Supabase — each coach can tune their
 * own playback / display behaviour without affecting drills shared with the
 * team. If we ever want club-wide defaults we'd add them as a separate layer.
 */
export interface TrainingSettings {
  /** Replace generic drill labels (A, B, 1) with real squad names. */
  substituteRealNames: boolean;
  /** Default speed used the next time a drill auto-plays on open. */
  defaultPlaybackSpeed: 0.5 | 1 | 2;
  /** Loop animation when it reaches the last frame. */
  loopPlayback: boolean;
  /** Render pitch lines (halfway, 18-yard box, centre circle). */
  showPitchMarkings: boolean;
  /** Default per-frame transition duration when adding a new frame (ms). */
  defaultFrameDurationMs: number;
  /** Auto-enter preview mode when opening a saved drill. */
  autoOpenInPreview: boolean;
  /** Show the drill's coaching points pinned over the preview. */
  showCoachingPointsInPreview: boolean;
}

export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = {
  substituteRealNames: true,
  defaultPlaybackSpeed: 1,
  loopPlayback: true,
  showPitchMarkings: true,
  defaultFrameDurationMs: 1500,
  autoOpenInPreview: true,
  showCoachingPointsInPreview: false,
};

const STORAGE_KEY = "training-settings:v1";

function load(): TrainingSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TRAINING_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<TrainingSettings>;
    return { ...DEFAULT_TRAINING_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_TRAINING_SETTINGS;
  }
}

/**
 * Subscribes to a custom "training-settings-changed" event so updates from
 * the dialog instantly reflect on the board (and vice versa) without prop
 * drilling. Storage events handle the cross-tab case.
 */
const EVENT_NAME = "training-settings-changed";

export function useTrainingSettings() {
  const [settings, setSettings] = useState<TrainingSettings>(load);

  useEffect(() => {
    const onChange = () => setSettings(load());
    window.addEventListener(EVENT_NAME, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const update = useCallback((patch: Partial<TrainingSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        window.dispatchEvent(new Event(EVENT_NAME));
      } catch {
        /* quota / private mode — ignore */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event(EVENT_NAME));
    } catch {
      /* ignore */
    }
    setSettings(DEFAULT_TRAINING_SETTINGS);
  }, []);

  return { settings, update, reset };
}
