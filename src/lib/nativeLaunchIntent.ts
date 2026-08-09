/**
 * Native launch-intent readiness boundary.
 *
 * Cold-start race: `App.getLaunchUrl()` is async, but React + the Router mount
 * synchronously right after `initDeepLinkHandler()` is called. The protected
 * "/" route therefore redirects an unauthenticated user to generic `/auth`
 * before the emailed `/join/p/:token` launch URL is known — so the first tap on
 * an invite link showed the login screen instead of the invite journey.
 *
 * This module owns an explicit readiness state that routing can wait on:
 *
 *   pending          – native launch intent not resolved yet
 *   failed-retrying  – getLaunchUrl() rejected, bounded retry in flight
 *   resolved-none    – ordinary launch, no URL
 *   resolved-url     – a launch URL was received and queued/handled
 *
 * Guarantees:
 * - Non-native platforms are `resolved-none` immediately (zero behaviour change).
 * - The wait is always bounded (`MAX_WAIT_MS`) so an ordinary launch can never
 *   hang on a spinner.
 * - `appUrlOpen` arriving while pending settles the boundary immediately.
 */
import { Capacitor } from "@capacitor/core";

export type LaunchIntentState =
  | "pending"
  | "failed-retrying"
  | "resolved-none"
  | "resolved-url";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 200;
/** Hard ceiling on how long routing may be held back. */
const MAX_WAIT_MS = 2500;

let state: LaunchIntentState = Capacitor.isNativePlatform()
  ? "pending"
  : "resolved-none";
let started = false;
let ceiling: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(s: LaunchIntentState) => void>();

export function getLaunchIntentState(): LaunchIntentState {
  return state;
}

export function isLaunchIntentPending(): boolean {
  return state === "pending" || state === "failed-retrying";
}

export function subscribeLaunchIntent(fn: (s: LaunchIntentState) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setState(next: LaunchIntentState) {
  if (state === next) return;
  // Once settled, never go back to a blocking state.
  if (!isLaunchIntentPending() && (next === "pending" || next === "failed-retrying")) return;
  state = next;
  if (!isLaunchIntentPending() && ceiling) {
    clearTimeout(ceiling);
    ceiling = null;
  }
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch (err) {
      console.error("[LaunchIntent] listener failed", err);
    }
  });
}

/** Called when `appUrlOpen` delivers a URL — settles the boundary at once. */
export function markLaunchUrlReceived() {
  setState("resolved-url");
}

/** Called when the launch-URL read completes with no URL. */
export function markLaunchIntentNone() {
  setState("resolved-none");
}

/**
 * Resolve the native launch URL with bounded retries, handing any URL found to
 * `onUrl`. Safe to call once at startup; subsequent calls are no-ops.
 */
export function beginLaunchIntentResolution(
  readLaunchUrl: () => Promise<{ url?: string | null } | null | undefined>,
  onUrl: (url: string) => void,
) {
  if (started) return;
  started = true;

  if (!Capacitor.isNativePlatform()) {
    setState("resolved-none");
    return;
  }

  ceiling = setTimeout(() => {
    if (isLaunchIntentPending()) {
      console.warn("[LaunchIntent] Bounded wait elapsed — releasing startup boundary");
      setState("resolved-none");
    }
  }, MAX_WAIT_MS);

  const attempt = (n: number) => {
    // A concurrent `appUrlOpen` may already have settled things.
    if (state === "resolved-url") return;
    readLaunchUrl()
      .then((result) => {
        if (result?.url) {
          console.log("[LaunchIntent] Launch URL detected:", result.url);
          // Queue/handle the destination BEFORE releasing the boundary so the
          // router bridge flushes to the invite route, never to /auth.
          try {
            onUrl(result.url);
          } finally {
            setState("resolved-url");
          }
        } else {
          setState("resolved-none");
        }
      })
      .catch((err) => {
        console.warn(`[LaunchIntent] getLaunchUrl attempt ${n} failed:`, err);
        if (n >= MAX_ATTEMPTS) {
          setState("resolved-none");
          return;
        }
        setState("failed-retrying");
        setTimeout(() => attempt(n + 1), RETRY_DELAY_MS);
      });
  };

  attempt(1);
}

/** Test helper. */
export function __resetLaunchIntentForTests() {
  if (ceiling) clearTimeout(ceiling);
  ceiling = null;
  started = false;
  state = Capacitor.isNativePlatform() ? "pending" : "resolved-none";
  listeners.clear();
}
