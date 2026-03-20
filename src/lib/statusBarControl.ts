import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Centralized status bar control with serial queue to prevent
 * interleaved async calls that cause icon color mismatches.
 */

let pending: Promise<void> = Promise.resolve();
let lastApplied: string | null = null;

const getThemeSync = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    if (document.documentElement.classList.contains('dark')) return 'dark';
    if (document.documentElement.classList.contains('light')) return 'light';
    const stored = localStorage.getItem('app-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  }
  return 'light';
};

/**
 * Apply status bar style for the given theme.
 * Calls are serialized so concurrent invocations never interleave.
 */
export const applyStatusBar = (theme?: 'light' | 'dark', force = false): void => {
  const resolved = theme ?? getThemeSync();

  // Enqueue – each call waits for the previous one to finish
  pending = pending
    .then(() => applyInternal(resolved, force))
    .catch((err) => console.warn('[StatusBar] queue error', err));
};

/**
 * Re-read the current theme from DOM and force-apply.
 * Useful after app resume or PitchBoard unmount.
 */
export const refreshStatusBar = (): void => {
  applyStatusBar(getThemeSync(), true);
};

// ── internal ────────────────────────────────────────────────
async function applyInternal(theme: 'light' | 'dark', force: boolean) {
  if (!Capacitor.isNativePlatform()) return;
  if (!force && lastApplied === theme) return;

  lastApplied = theme;

  try {
    // Ensure status bar is visible first
    await StatusBar.show();

    if (theme === 'dark') {
      await StatusBar.setStyle({ style: Style.Dark });
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({ color: '#0f1512' });
      }
    } else {
      await StatusBar.setStyle({ style: Style.Light });
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({ color: '#f5f7f6' });
      }
    }

    // Ensure WebView is NOT behind status bar so content doesn't overlap
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch (error) {
    console.warn('[StatusBar] Error configuring status bar:', error);
  }
}
