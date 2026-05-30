import { useEffect, useState, useCallback } from "react";

/**
 * Lightweight, contextual onboarding for the long-press message interaction.
 *
 * Two surfaces:
 *   1. Compact dismissible banner above the composer (persists until the
 *      user closes it OR until they successfully long-press a message).
 *   2. Tap tooltip anchored to a tapped bubble (auto-dismiss ~2.5s, hidden
 *      once the user has long-pressed once, capped per-session to avoid
 *      repetition).
 *
 * State persisted in localStorage under one `ignite_` key so it is swept by
 * `clearUserScopedCaches`:
 *   - `completed`:  user performed a successful long-press at least once.
 *   - `dismissed`:  user closed the banner explicitly.
 *   - `tapHints`:   how many tap tooltips we've shown (cap to avoid noise).
 */

const STORAGE_KEY = "ignite_chat_actions_onboarding_v1";
const MAX_TAP_HINTS = 4;
const TAP_HINT_COOLDOWN_MS = 20_000;

interface OnboardingState {
  completed: boolean;
  dismissed: boolean;
  tapHints: number;
}

function readState(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { completed: false, dismissed: false, tapHints: 0 };
    const parsed = JSON.parse(raw);
    return {
      completed: !!parsed.completed,
      dismissed: !!parsed.dismissed,
      tapHints: Number(parsed.tapHints) || 0,
    };
  } catch {
    return { completed: false, dismissed: false, tapHints: 0 };
  }
}

function writeState(next: OnboardingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

let lastTapHintAt = 0;

/** Marks the user as educated. Hides banner + future tap tooltips. */
export function markLongPressOnboardingCompleted() {
  const s = readState();
  if (s.completed) return;
  writeState({ ...s, completed: true });
  // Notify any mounted banners to hide immediately.
  try {
    window.dispatchEvent(new Event("ignite:chat-onboarding-changed"));
  } catch {}
}

/**
 * Decide whether to show an inline tap tooltip near the tapped message.
 * Returns true at most once per cooldown, and never after the user has
 * long-pressed successfully or after the cap is reached.
 */
export function shouldShowTapHint(): boolean {
  const s = readState();
  if (s.completed) return false;
  if (s.tapHints >= MAX_TAP_HINTS) return false;
  const now = Date.now();
  if (now - lastTapHintAt < TAP_HINT_COOLDOWN_MS) return false;
  lastTapHintAt = now;
  writeState({ ...s, tapHints: s.tapHints + 1 });
  return true;
}

/** React hook for the in-chat banner above the composer. */
export function useLongPressBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const evaluate = () => {
      const s = readState();
      setVisible(!s.completed && !s.dismissed);
    };
    // Defer a beat so the banner doesn't slam in during route transition.
    const t = setTimeout(evaluate, 250);
    window.addEventListener("ignite:chat-onboarding-changed", evaluate);
    return () => {
      clearTimeout(t);
      window.removeEventListener("ignite:chat-onboarding-changed", evaluate);
    };
  }, []);

  const dismiss = useCallback(() => {
    const s = readState();
    writeState({ ...s, dismissed: true });
    setVisible(false);
  }, []);

  return { visible, dismiss };
}
