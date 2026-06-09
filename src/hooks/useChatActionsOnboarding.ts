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
 * State persisted in localStorage. Intentionally NOT using the `ignite_`
 * prefix so the user's explicit dismissal survives sign-out / user-switch
 * cache sweeps in `clearUserScopedCaches` — once a user dismisses the tip
 * (or has long-pressed a message), it should stay dismissed forever on
 * that device:
 *   - `completed`:  user performed a successful long-press at least once.
 *   - `dismissed`:  user closed the banner explicitly.
 *   - `tapHints`:   how many tap tooltips we've shown (cap to avoid noise).
 */

const STORAGE_KEY = "chat_actions_onboarding_v1";
const LEGACY_STORAGE_KEY = "ignite_chat_actions_onboarding_v1";
// Show the tap-hint tooltip on every short tap until the user has actually
// long-pressed a message at least once. We only debounce by a short cooldown
// to prevent flicker from accidental rapid taps / double-taps on the same
// bubble — there is no hard cap, otherwise users who never discover the
// gesture stop getting reminded after a few taps and report it as "broken".
const MAX_TAP_HINTS = Number.POSITIVE_INFINITY;
const TAP_HINT_COOLDOWN_MS = 1_200;

interface OnboardingState {
  completed: boolean;
  dismissed: boolean;
  tapHints: number;
}

function readState(): OnboardingState {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STORAGE_KEY);
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
    // Clean up the legacy ignite_-prefixed key so the auth sweep doesn't
    // keep wiping a duplicate copy on every sign-in.
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch {}
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
    // Treat an explicit close as "forever": mark both dismissed AND completed
    // so the banner never reappears, even if storage flags are partially
    // cleared or the user later long-presses without us recording it.
    writeState({ ...s, dismissed: true, completed: true });
    setVisible(false);
    try {
      window.dispatchEvent(new Event("ignite:chat-onboarding-changed"));
    } catch {}
  }, []);

  return { visible, dismiss };
}
