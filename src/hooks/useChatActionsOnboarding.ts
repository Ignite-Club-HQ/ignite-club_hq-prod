import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";

/**
 * Lightweight, contextual onboarding for the long-press message interaction.
 *
 * Goal: help users discover that tapping a message no longer opens actions,
 * and that long-press is the new home for reactions, reply, edit and more.
 *
 * Three signals are tracked in localStorage under a single `ignite_` key
 * (so it's swept by `clearUserScopedCaches`):
 *   - `completed`: user has performed a successful long-press at least once.
 *   - `bannerSessions`: how many distinct chat sessions have shown the banner.
 *   - `tapHints`: how many times the "press and hold" toast has fired.
 *
 * Once `completed` flips true we never show anything again unless the key
 * is manually cleared.
 */

const STORAGE_KEY = "ignite_chat_actions_onboarding_v1";
const MAX_BANNER_SESSIONS = 4;
const MAX_TAP_HINTS = 3;
const TAP_HINT_COOLDOWN_MS = 25_000;

interface OnboardingState {
  completed: boolean;
  bannerSessions: number;
  tapHints: number;
}

function readState(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { completed: false, bannerSessions: 0, tapHints: 0 };
    const parsed = JSON.parse(raw);
    return {
      completed: !!parsed.completed,
      bannerSessions: Number(parsed.bannerSessions) || 0,
      tapHints: Number(parsed.tapHints) || 0,
    };
  } catch {
    return { completed: false, bannerSessions: 0, tapHints: 0 };
  }
}

function writeState(next: OnboardingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

let lastTapHintAt = 0;

/** Side-effect helpers callable from anywhere (e.g. ChatMessage gesture handlers). */
export function markLongPressOnboardingCompleted() {
  const s = readState();
  if (s.completed) return;
  writeState({ ...s, completed: true });
}

export function maybeShowTapHintToast(): boolean {
  const s = readState();
  if (s.completed) return false;
  if (s.tapHints >= MAX_TAP_HINTS) return false;
  const now = Date.now();
  if (now - lastTapHintAt < TAP_HINT_COOLDOWN_MS) return false;
  lastTapHintAt = now;
  writeState({ ...s, tapHints: s.tapHints + 1 });
  toast("Press and hold for reactions and message actions", {
    duration: 2400,
    position: "bottom-center",
    className: "text-xs",
  });
  return true;
}

/** React hook for the in-chat banner above the composer. */
export function useLongPressBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const s = readState();
    if (s.completed || s.bannerSessions >= MAX_BANNER_SESSIONS) return;
    // Defer a beat so the banner doesn't slam in during route transition.
    const showTimer = setTimeout(() => {
      setVisible(true);
      writeState({ ...readState(), bannerSessions: readState().bannerSessions + 1 });
    }, 350);
    return () => clearTimeout(showTimer);
  }, []);

  // Auto-hide after a few seconds so it never lingers.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [visible]);

  const dismiss = useCallback(() => setVisible(false), []);

  return { visible, dismiss };
}
